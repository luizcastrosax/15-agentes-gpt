"""6. Liquidity Engine (G3).

Constrói pools de liquidez e detecta sweeps com ciclo de vida causal.

Pools construídos no baseline
-----------------------------
- ``PREV_DAY_HIGH`` / ``PREV_DAY_LOW`` — extremos do dia local anterior.
- ``SESSION_HIGH`` / ``SESSION_LOW`` — extremos do dia local corrente até
  ``as_of`` (apenas barras fechadas).
- ``EQUAL_HIGHS`` / ``EQUAL_LOWS`` — pivôs confirmados agrupados dentro de
  ``equal_level_tolerance_ticks``.

Todos são ``SourceKind.PROXY`` com ``proxy_for="resting_stop_liquidity"``:
o sistema **não observa** ordens em repouso. Ele infere, a partir de preço,
onde stops provavelmente se acumulam. Rotular isso como proxy é obrigatório e
faz o Gate G3 no máximo ``CONDITIONAL`` quando não há confirmação adicional.

Ciclo de vida do sweep
----------------------
1. Penetração além do pool na barra ``i`` (entre ``min`` e ``max`` ticks) ⇒
   ``SweepEvent`` ``PENDING`` (detectado, **não** confirmado, invisível a gates).
2. Após ``confirmation_bars`` fechadas: se o fechamento voltou para o lado de
   origem ⇒ ``REJECTED`` (confirmado). Caso contrário ⇒ ``ACCEPTED_THROUGH``.
3. Um sweep confirmado permanece "ativo" por ``sweep_validity_bars`` barras.

Limitação declarada: sem volume por preço nem book, a "força" do pool não é
mensurável. ``touch_count`` é o único proxy de relevância disponível.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Sequence
from zoneinfo import ZoneInfo

from ..contracts.context import EvaluationContext
from ..domain.assessments import LiquidityAssessment
from ..domain.enums import LiquidityPoolKind, SourceKind, SweepOutcome
from ..domain.events import LiquidityPool, SweepEvent
from ..domain.market import Bar
from ..features.indicators import swing_points

__all__ = ["BaselineLiquidityEngine"]

_PROXY_FOR = "resting_stop_liquidity"


class BaselineLiquidityEngine:
    def assess(self, ctx: EvaluationContext) -> LiquidityAssessment:
        cfg = ctx.config.liquidity
        latency = timedelta(milliseconds=ctx.config.runtime.ingestion_latency_ms)
        tz = ZoneInfo(ctx.config.session.timezone)

        pool_bars: Sequence[Bar] = ctx.snapshot.closed(cfg.pool_timeframe)
        det_bars: Sequence[Bar] = ctx.snapshot.closed(cfg.detection_timeframe)

        notes: list[str] = []
        if not pool_bars:
            notes.append(f"sem barras confirmadas em {cfg.pool_timeframe} para pools")
        if not det_bars:
            notes.append(f"sem barras confirmadas em {cfg.detection_timeframe} para sweeps")

        pools = self._build_pools(ctx, pool_bars, latency, tz)
        if not pools:
            return LiquidityAssessment(
                pools=(),
                active_sweep=None,
                pending_sweeps=(),
                uses_proxy=True,
                notes=tuple(notes + ["nenhum pool de liquidez construído"]),
            )

        confirmed, pending = self._detect_sweeps(ctx, pools, det_bars, latency)
        active = self._active_sweep(ctx, confirmed, det_bars)

        notes.append(f"{len(pools)} pools; {len(confirmed)} sweeps confirmados")
        notes.append(
            "pools são PROXY de liquidez em repouso: derivados de preço, "
            "não de observação de ordens"
        )
        return LiquidityAssessment(
            pools=pools,
            active_sweep=active,
            pending_sweeps=pending,
            uses_proxy=True,
            notes=tuple(notes),
        )

    # -- pools -------------------------------------------------------------

    def _build_pools(
        self,
        ctx: EvaluationContext,
        bars: Sequence[Bar],
        latency: timedelta,
        tz: ZoneInfo,
    ) -> tuple[LiquidityPool, ...]:
        if not bars:
            return ()
        cfg = ctx.config.liquidity
        tick = ctx.config.instrument.tick_size
        pools: list[LiquidityPool] = []

        by_day: dict[str, list[Bar]] = {}
        for b in bars:
            key = b.close_time.astimezone(tz).date().isoformat()
            by_day.setdefault(key, []).append(b)
        days = sorted(by_day)

        current_day = days[-1]
        if len(days) >= 2:
            prev_day = days[-2]
            prev_bars = by_day[prev_day]
            prev_end = prev_bars[-1].close_time
            pools.append(
                LiquidityPool.make(
                    kind=LiquidityPoolKind.PREV_DAY_HIGH,
                    price=max(b.high for b in prev_bars),
                    timeframe=cfg.pool_timeframe,
                    detected_at=prev_end,
                    confirmed_at=prev_end,
                    available_at=prev_end + latency,
                    source=SourceKind.PROXY,
                    proxy_for=_PROXY_FOR,
                )
            )
            pools.append(
                LiquidityPool.make(
                    kind=LiquidityPoolKind.PREV_DAY_LOW,
                    price=min(b.low for b in prev_bars),
                    timeframe=cfg.pool_timeframe,
                    detected_at=prev_end,
                    confirmed_at=prev_end,
                    available_at=prev_end + latency,
                    source=SourceKind.PROXY,
                    proxy_for=_PROXY_FOR,
                )
            )
        else:
            # Um único dia de histórico não permite PDH/PDL. Não inventamos.
            pass

        cur_bars = by_day[current_day]
        cur_end = cur_bars[-1].close_time
        pools.append(
            LiquidityPool.make(
                kind=LiquidityPoolKind.SESSION_HIGH,
                price=max(b.high for b in cur_bars),
                timeframe=cfg.pool_timeframe,
                detected_at=cur_end,
                confirmed_at=cur_end,
                available_at=cur_end + latency,
                source=SourceKind.PROXY,
                proxy_for=_PROXY_FOR,
            )
        )
        pools.append(
            LiquidityPool.make(
                kind=LiquidityPoolKind.SESSION_LOW,
                price=min(b.low for b in cur_bars),
                timeframe=cfg.pool_timeframe,
                detected_at=cur_end,
                confirmed_at=cur_end,
                available_at=cur_end + latency,
                source=SourceKind.PROXY,
                proxy_for=_PROXY_FOR,
            )
        )

        pools.extend(
            self._equal_levels(ctx, bars, latency, tick, is_high=True)
        )
        pools.extend(
            self._equal_levels(ctx, bars, latency, tick, is_high=False)
        )

        visible = [p for p in pools if p.timing.confirmed_visible_at(ctx.now)]
        # Mantém os pools mais próximos do preço corrente: são os que o mercado
        # pode alcançar. Distância é o critério, não preço absoluto.
        reference = bars[-1].close
        highs = sorted(
            (p for p in visible if p.is_high_side),
            key=lambda p: (abs(p.price - reference), p.pool_id),
        )[: cfg.max_pools_per_side]
        lows = sorted(
            (p for p in visible if not p.is_high_side),
            key=lambda p: (abs(p.price - reference), p.pool_id),
        )[: cfg.max_pools_per_side]
        return tuple(highs + lows)

    def _equal_levels(
        self,
        ctx: EvaluationContext,
        bars: Sequence[Bar],
        latency: timedelta,
        tick: float,
        is_high: bool,
    ) -> list[LiquidityPool]:
        cfg = ctx.config.liquidity
        high_idx, low_idx = swing_points(bars, cfg.swing_lookback)
        idxs = high_idx if is_high else low_idx
        if len(idxs) < 2:
            return []
        tol = cfg.equal_level_tolerance_ticks * tick

        prices = [(i, bars[i].high if is_high else bars[i].low) for i in idxs]
        clusters: list[list[tuple[int, float]]] = []
        for item in sorted(prices, key=lambda p: p[1]):
            if clusters and abs(item[1] - clusters[-1][-1][1]) <= tol:
                clusters[-1].append(item)
            else:
                clusters.append([item])

        out: list[LiquidityPool] = []
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            level = (
                max(p for _, p in cluster) if is_high else min(p for _, p in cluster)
            )
            # Confirmação: o pivô mais recente do cluster + lookback barras.
            last_idx = max(i for i, _ in cluster)
            confirm_idx = min(last_idx + cfg.swing_lookback, len(bars) - 1)
            confirmed_at = bars[confirm_idx].close_time
            out.append(
                LiquidityPool.make(
                    kind=(
                        LiquidityPoolKind.EQUAL_HIGHS
                        if is_high
                        else LiquidityPoolKind.EQUAL_LOWS
                    ),
                    price=level,
                    timeframe=cfg.pool_timeframe,
                    detected_at=confirmed_at,
                    confirmed_at=confirmed_at,
                    available_at=confirmed_at + latency,
                    source=SourceKind.PROXY,
                    proxy_for=_PROXY_FOR,
                    touch_count=len(cluster),
                    tolerance_ticks=cfg.equal_level_tolerance_ticks,
                )
            )
        return out

    # -- sweeps ------------------------------------------------------------

    def _detect_sweeps(
        self,
        ctx: EvaluationContext,
        pools: Sequence[LiquidityPool],
        bars: Sequence[Bar],
        latency: timedelta,
    ) -> tuple[tuple[SweepEvent, ...], tuple[SweepEvent, ...]]:
        cfg = ctx.config.liquidity
        tick = ctx.config.instrument.tick_size
        confirmed: list[SweepEvent] = []
        pending: list[SweepEvent] = []

        for pool in pools:
            for i, bar in enumerate(bars):
                # O pool precisa já estar disponível no fechamento da barra
                # gatilho — caso contrário seria conhecimento futuro.
                if not pool.timing.confirmed_visible_at(bar.close_time):
                    continue

                if pool.is_high_side:
                    penetration = bar.high - pool.price
                else:
                    penetration = pool.price - bar.low
                if penetration <= 0:
                    continue
                ticks = penetration / tick
                if ticks < cfg.min_penetration_ticks or ticks > cfg.max_penetration_ticks:
                    continue

                sweep = SweepEvent.pending(
                    pool=pool,
                    side=pool.sweep_side,
                    timeframe=cfg.detection_timeframe,
                    penetration_price=bar.high if pool.is_high_side else bar.low,
                    penetration_ticks=ticks,
                    trigger_bar_close_time=bar.close_time,
                    detected_at=bar.close_time,
                )

                conf_idx = i + cfg.confirmation_bars
                if conf_idx >= len(bars):
                    if sweep.timing.visible_at(ctx.now):
                        pending.append(sweep)
                    continue

                conf_bar = bars[conf_idx]
                window = bars[i + 1 : conf_idx + 1]
                if pool.is_high_side:
                    rejected = all(b.close < pool.price for b in window)
                else:
                    rejected = all(b.close > pool.price for b in window)
                outcome = SweepOutcome.REJECTED if rejected else SweepOutcome.ACCEPTED_THROUGH
                event = sweep.confirm_as(
                    outcome=outcome,
                    confirmation_bar_close_time=conf_bar.close_time,
                    available_at=conf_bar.close_time + latency,
                )
                if event.timing.confirmed_visible_at(ctx.now):
                    confirmed.append(event)

        confirmed.sort(key=lambda s: s.timing.confirmed_at or s.timing.detected_at)
        pending.sort(key=lambda s: s.timing.detected_at)
        return tuple(confirmed), tuple(pending)

    def _active_sweep(
        self,
        ctx: EvaluationContext,
        confirmed: Sequence[SweepEvent],
        bars: Sequence[Bar],
    ) -> SweepEvent | None:
        """Sweep rejeitado mais recente ainda dentro da janela de validade."""
        if not confirmed or not bars:
            return None
        cfg = ctx.config.liquidity
        horizon = bars[max(0, len(bars) - cfg.sweep_validity_bars)].close_time
        for sweep in reversed(confirmed):
            if sweep.outcome is not SweepOutcome.REJECTED:
                continue
            assert sweep.confirmation_bar_close_time is not None
            if sweep.confirmation_bar_close_time >= horizon:
                return sweep
            return None
        return None

