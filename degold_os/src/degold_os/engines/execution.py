"""9. Execution Engine (G6).

Constrói o ``TradePlan``. **Nunca envia ordem** — enviar é responsabilidade do
Broker Adapter, e em v1 não existe adapter capaz de execução real.

Geometria baseline (setup: sweep + rejeição)
--------------------------------------------
Para um sweep de *highs* rejeitado (lado SHORT):

- ``entry``  = mínima da última barra fechada do TF de entrada − ``entry_offset_ticks``
  (ordem STOP: exige continuidade, não antecipa).
- ``stop``   = extremo da penetração do sweep + ``stop_buffer_ticks``.
- ``target`` = ``entry − target_r_multiple × risco``.

Simétrico para LONG. Toda a geometria é validada por ``TradePlan``, que recusa
combinações incoerentes por construção.

Custos
------
``cost_points`` = spread + 2 × slippage assumido (entrada e saída). Se não há
cotação bid/ask, o spread vem de ``assumed_spread_ticks`` e é marcado como
``PROXY``. O sistema jamais assume spread zero.

``rr_net`` usa o custo: ``(reward − custo) / (risco + custo)``. Um R:R bruto
sem custo é enganoso e não é usado em nenhum gate.
"""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import (
    AcceptanceAssessment,
    LiquidityAssessment,
    OrderIntent,
    TradePlan,
)
from ..domain.enums import (
    OrderIntentKind,
    OrderType,
    Side,
    SourceKind,
    TimeInForce,
    TIMEFRAME_SECONDS,
)
from ..domain.errors import ContractViolation
from ..domain.market import Bar
from ..domain.measurement import Measurement

__all__ = ["BaselineExecutionEngine"]


class BaselineExecutionEngine:
    def build_plan(
        self,
        ctx: EvaluationContext,
        side: Side,
        liquidity: LiquidityAssessment,
        acceptance: AcceptanceAssessment,
        quantity: int,
    ) -> TradePlan | None:
        cfg = ctx.config.execution
        inst = ctx.config.instrument
        tick = inst.tick_size
        sweep = liquidity.active_sweep

        if sweep is None:
            return None
        if quantity < 1:
            return None

        bars: Sequence[Bar] = ctx.snapshot.closed(cfg.entry_timeframe)
        if not bars:
            return None
        ref = bars[-1]

        if side is Side.SHORT:
            entry = inst.round_to_tick(ref.low - cfg.entry_offset_ticks * tick)
            stop = inst.round_to_tick(sweep.penetration_price + cfg.stop_buffer_ticks * tick)
            risk_points = stop - entry
        else:
            entry = inst.round_to_tick(ref.high + cfg.entry_offset_ticks * tick)
            stop = inst.round_to_tick(sweep.penetration_price - cfg.stop_buffer_ticks * tick)
            risk_points = entry - stop

        if risk_points <= 0:
            return None

        stop_ticks = risk_points / tick
        if stop_ticks < cfg.min_stop_ticks or stop_ticks > cfg.max_stop_ticks:
            return None

        reward_points = risk_points * cfg.target_r_multiple
        target = inst.round_to_tick(
            entry - reward_points if side is Side.SHORT else entry + reward_points
        )

        cost_measure = self._cost_points(ctx)
        cost = cost_measure.value
        rr = reward_points / risk_points
        rr_net = (reward_points - cost) / (risk_points + cost) if (risk_points + cost) > 0 else None

        validity = None
        if cfg.validity_bars > 0:
            validity = ref.close_time + timedelta(
                seconds=TIMEFRAME_SECONDS[cfg.entry_timeframe] * cfg.validity_bars
            )

        tag = f"degold:{ctx.config.maturity.setup_id}:{sweep.sweep_id}"
        entry_intent = OrderIntent(
            kind=str(OrderIntentKind.ENTRY),
            side=side,
            order_type=OrderType.STOP,
            quantity=quantity,
            price=None,
            stop_price=entry,
            time_in_force=TimeInForce.DAY,
            client_tag=tag,
        )
        exit_side = Side.LONG if side is Side.SHORT else Side.SHORT
        stop_intent = OrderIntent(
            kind=str(OrderIntentKind.STOP_LOSS),
            side=exit_side,
            order_type=OrderType.STOP,
            quantity=quantity,
            price=None,
            stop_price=stop,
            time_in_force=TimeInForce.DAY,
            client_tag=tag,
        )
        target_intent = OrderIntent(
            kind=str(OrderIntentKind.TAKE_PROFIT),
            side=exit_side,
            order_type=OrderType.LIMIT,
            quantity=quantity,
            price=target,
            time_in_force=TimeInForce.DAY,
            client_tag=tag,
        )

        notes = [
            f"entrada STOP a partir do extremo da última barra {cfg.entry_timeframe}",
            f"stop além do extremo do sweep ({sweep.penetration_price:.2f}) "
            f"+ {cfg.stop_buffer_ticks} ticks",
            f"custo assumido {cost:.2f} pts ({cost_measure.method})",
        ]
        if acceptance.reference_price is not None:
            notes.append(f"nível de referência do setup: {acceptance.reference_price:.2f}")

        try:
            return TradePlan(
                side=side,
                entry_price=entry,
                stop_price=stop,
                target_price=target,
                quantity=quantity,
                risk_points=risk_points,
                reward_points=reward_points,
                risk_money=inst.money(risk_points, quantity),
                rr=rr,
                cost_points=cost_measure,
                rr_net=rr_net,
                entry_intent=entry_intent,
                stop_intent=stop_intent,
                target_intent=target_intent,
                valid_until=validity,
                invalidation_price=sweep.penetration_price,
                notes=tuple(notes),
            )
        except ContractViolation:
            # Geometria degenerada (ex.: target colapsa no entry após
            # arredondamento por tick). Sem plano é melhor que plano inválido.
            return None

    def max_quantity_for_risk(
        self, ctx: EvaluationContext, risk_money_budget: float, stop_points: float
    ) -> int:
        inst = ctx.config.instrument
        if stop_points <= 0 or risk_money_budget <= 0:
            return 0
        per_contract = inst.money(stop_points, 1)
        if per_contract <= 0:
            return 0
        qty = int(math.floor(risk_money_budget / per_contract))
        return max(0, min(qty, ctx.config.risk.max_contracts))

    # -- internos ----------------------------------------------------------

    def _cost_points(self, ctx: EvaluationContext) -> Measurement:
        cfg = ctx.config.execution
        tick = ctx.config.instrument.tick_size
        quote = ctx.snapshot.quote
        slippage = 2 * cfg.assumed_slippage_ticks * tick

        if quote is not None and quote.spread is not None and quote.spread >= 0:
            return Measurement(
                value=quote.spread + slippage,
                unit="points",
                source=SourceKind.DERIVED,
                method=(
                    f"spread medido ({quote.spread / tick:.2f} ticks) + "
                    f"2×{cfg.assumed_slippage_ticks} ticks de slippage assumido"
                ),
                sample_size=1,
            )
        return Measurement(
            value=cfg.assumed_spread_ticks * tick + slippage,
            unit="points",
            source=SourceKind.PROXY,
            proxy_for="effective_transaction_cost",
            method=(
                f"spread assumido ({cfg.assumed_spread_ticks} ticks) + "
                f"2×{cfg.assumed_slippage_ticks} ticks de slippage assumido "
                "— sem cotação bid/ask disponível"
            ),
        )
