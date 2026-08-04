"""5. Structure Engine.

Detecta BOS (Break of Structure) e CHoCH (Change of Character) no timeframe
configurado (M2 no MVP), usando **apenas fechamento** de barra como critério
de rompimento.

Regras causais:

- Pivôs são confirmados com ``swing_lookback`` barras fechadas de cada lado.
  O pivô só existe (e só é utilizável) após o fechamento da última barra da
  direita — ``available_at`` reflete isso.
- Rompimento exige ``close`` além do pivô por pelo menos ``min_break_ticks``.
  Penetração por pavio não é estrutura: é sweep, e pertence ao Liquidity
  Engine.
- CHoCH é o primeiro rompimento contrário à direção estrutural vigente; BOS é
  a continuação. A direção vigente é derivada do último sinal confirmado.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import StructureAssessment
from ..domain.enums import StructureEvent, TrendDirection
from ..domain.events import StructureSignal
from ..domain.market import Bar
from ..features.indicators import swing_points

__all__ = ["BaselineStructureEngine"]


class BaselineStructureEngine:
    def assess(self, ctx: EvaluationContext) -> StructureAssessment:
        cfg = ctx.config.structure
        tf = cfg.timeframe
        bars: Sequence[Bar] = ctx.snapshot.closed(tf)
        latency = timedelta(milliseconds=ctx.config.runtime.ingestion_latency_ms)
        tick = ctx.config.instrument.tick_size

        if len(bars) < 2 * cfg.swing_lookback + 2:
            return StructureAssessment(
                timeframe=tf,
                last_event=StructureEvent.NONE,
                direction=TrendDirection.UNKNOWN,
                notes=(
                    f"amostra insuficiente em {tf}: {len(bars)} barras confirmadas, "
                    f"exigidas {2 * cfg.swing_lookback + 2}",
                ),
            )

        high_idx, low_idx = swing_points(bars, cfg.swing_lookback)
        if not high_idx and not low_idx:
            return StructureAssessment(
                timeframe=tf,
                last_event=StructureEvent.NONE,
                direction=TrendDirection.SIDEWAYS,
                notes=("nenhum pivô confirmado na janela",),
            )

        signals: list[StructureSignal] = []
        direction = TrendDirection.SIDEWAYS
        min_break = cfg.min_break_ticks * tick

        # Varre barras em ordem; para cada barra, considera apenas pivôs cuja
        # confirmação já ocorreu antes dela (índice do pivô + lookback < i).
        for i in range(cfg.swing_lookback + 1, len(bars)):
            bar = bars[i]
            usable_highs = [j for j in high_idx if j + cfg.swing_lookback < i]
            usable_lows = [j for j in low_idx if j + cfg.swing_lookback < i]
            ref_high = bars[usable_highs[-1]].high if usable_highs else None
            ref_low = bars[usable_lows[-1]].low if usable_lows else None

            event: StructureEvent | None = None
            reference: float | None = None
            ref_id: str | None = None

            if ref_high is not None and bar.close > ref_high + min_break:
                event = (
                    StructureEvent.CHOCH_UP
                    if direction is TrendDirection.DOWN
                    else StructureEvent.BOS_UP
                )
                reference = ref_high
                ref_id = f"{tf}:swing_high@{bars[usable_highs[-1]].close_time.isoformat()}"
                direction = TrendDirection.UP
            elif ref_low is not None and bar.close < ref_low - min_break:
                event = (
                    StructureEvent.CHOCH_DOWN
                    if direction is TrendDirection.UP
                    else StructureEvent.BOS_DOWN
                )
                reference = ref_low
                ref_id = f"{tf}:swing_low@{bars[usable_lows[-1]].close_time.isoformat()}"
                direction = TrendDirection.DOWN

            if event is not None and reference is not None:
                signals.append(
                    StructureSignal.make(
                        timeframe=tf,
                        event=event,
                        reference_price=reference,
                        break_price=bar.close,
                        confirmed_at=bar.close_time,
                        available_at=bar.close_time + latency,
                        reference_point_id=ref_id,
                        evidence={
                            "min_break_ticks": cfg.min_break_ticks,
                            "swing_lookback": cfg.swing_lookback,
                        },
                    )
                )

        visible = tuple(s for s in signals if s.timing.confirmed_visible_at(ctx.now))
        last_event = visible[-1].event if visible else StructureEvent.NONE

        last_high = bars[high_idx[-1]].high if high_idx else None
        last_low = bars[low_idx[-1]].low if low_idx else None

        return StructureAssessment(
            timeframe=tf,
            last_event=last_event,
            direction=direction,
            signals=visible[-10:],
            last_swing_high=last_high,
            last_swing_low=last_low,
            notes=(
                f"{len(visible)} sinais estruturais confirmados e visíveis em as_of",
                "rompimento avaliado somente por fechamento (pavio não conta)",
            ),
        )
