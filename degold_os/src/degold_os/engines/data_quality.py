"""1. Data Quality Engine (G0).

Verifica, por timeframe: quantidade mínima de barras confirmadas, obsolescência
(staleness), buracos na grade temporal, duplicatas e desordem. Além disso,
verifica o frescor do feed e a presença de cotação.

Fail-closed: ``UNUSABLE`` em qualquer timeframe requerido ⇒ G0 FAIL ⇒ NO_TRADE.
``NOT_AVAILABLE`` (nenhum dado) é distinto de ``UNUSABLE`` (dado ruim) e
igualmente bloqueante — a diferença existe para diagnóstico, não para
permissividade.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import DataQualityReport, TimeframeHealth
from ..domain.enums import DataQualityStatus, TIMEFRAME_SECONDS, Timeframe
from ..domain.market import Bar

__all__ = ["BaselineDataQualityEngine"]


class BaselineDataQualityEngine:
    """Implementação baseline, puramente estrutural (sem heurística de preço)."""

    def assess(self, ctx: EvaluationContext) -> DataQualityReport:
        cfg = ctx.config.data_quality
        now = ctx.now
        notes: list[str] = []
        healths: list[TimeframeHealth] = []
        worst = DataQualityStatus.OK

        for tf in cfg.required_timeframes:
            health = self._timeframe_health(ctx, tf)
            healths.append(health)
            worst = _worse(worst, health.status)
            if health.status is not DataQualityStatus.OK:
                notes.append(f"{tf}: {health.status}")

        feed_staleness: float | None = None
        if ctx.snapshot.feed_last_message_at is not None:
            feed_staleness = (now - ctx.snapshot.feed_last_message_at).total_seconds()
            if feed_staleness < 0:
                notes.append(
                    "feed_last_message_at está no futuro em relação a as_of "
                    "(relógio dessincronizado ou vazamento de dado futuro)"
                )
                worst = DataQualityStatus.UNUSABLE
            elif feed_staleness > cfg.max_feed_staleness_seconds:
                notes.append(
                    f"feed obsoleto: {feed_staleness:.1f}s > "
                    f"{cfg.max_feed_staleness_seconds:.1f}s"
                )
                worst = DataQualityStatus.UNUSABLE
        else:
            # Ausência de heartbeat NÃO é feed saudável.
            notes.append("feed_last_message_at ausente: frescor do feed desconhecido")
            worst = _worse(worst, DataQualityStatus.DEGRADED)

        quote_available = ctx.snapshot.quote is not None and (
            ctx.snapshot.quote.bid is not None and ctx.snapshot.quote.ask is not None
        )
        if not quote_available:
            notes.append("cotação bid/ask indisponível: spread será tratado como proxy")

        return DataQualityReport(
            status=worst,
            per_timeframe=tuple(healths),
            feed_staleness_seconds=feed_staleness,
            quote_available=quote_available,
            notes=tuple(notes),
        )

    # -- internos ----------------------------------------------------------

    def _timeframe_health(self, ctx: EvaluationContext, tf: Timeframe) -> TimeframeHealth:
        cfg = ctx.config.data_quality
        series = ctx.snapshot.get(tf)
        if series is None:
            return TimeframeHealth(
                timeframe=tf,
                bars_available=0,
                staleness_seconds=None,
                gaps_detected=0,
                duplicates_detected=0,
                out_of_order_detected=0,
                status=DataQualityStatus.NOT_AVAILABLE,
            )

        bars = series.closed_as_of(ctx.now)
        n = len(bars)
        min_bars = cfg.min_bars.get(str(tf), 0)

        if n == 0:
            return TimeframeHealth(
                timeframe=tf,
                bars_available=0,
                staleness_seconds=None,
                gaps_detected=0,
                duplicates_detected=0,
                out_of_order_detected=0,
                status=DataQualityStatus.NOT_AVAILABLE,
            )

        gaps, dups, ooo = _grid_issues(bars, tf)
        staleness = (ctx.now - bars[-1].close_time).total_seconds()
        max_staleness = TIMEFRAME_SECONDS[tf] * cfg.max_staleness_multiple

        status = DataQualityStatus.OK
        if n < min_bars:
            status = DataQualityStatus.UNUSABLE
        elif staleness > max_staleness:
            status = DataQualityStatus.UNUSABLE
        elif dups or ooo:
            status = DataQualityStatus.UNUSABLE
        elif gaps:
            status = DataQualityStatus.DEGRADED

        return TimeframeHealth(
            timeframe=tf,
            bars_available=n,
            staleness_seconds=staleness,
            gaps_detected=gaps,
            duplicates_detected=dups,
            out_of_order_detected=ooo,
            status=status,
        )


def _grid_issues(bars: Sequence[Bar], tf: Timeframe) -> tuple[int, int, int]:
    """Conta buracos, duplicatas e desordem na grade temporal.

    Observação honesta: buracos por feriado/pausa de sessão contam como gap
    aqui. O baseline não conhece o calendário de pregão do CME, portanto o gap
    é sinalizado como ``DEGRADED``, não como ``UNUSABLE`` — e a nota fica no
    relatório para inspeção humana. Um calendário de sessões real remove essa
    ambiguidade e deve substituir esta heurística antes do live.
    """
    step = timedelta(seconds=TIMEFRAME_SECONDS[tf])
    gaps = dups = ooo = 0
    for prev, cur in zip(bars, bars[1:]):
        delta = cur.open_time - prev.open_time
        if delta == timedelta(0):
            dups += 1
        elif delta < timedelta(0):
            ooo += 1
        elif delta > step:
            gaps += 1
    return gaps, dups, ooo


_SEVERITY = {
    DataQualityStatus.OK: 0,
    DataQualityStatus.DEGRADED: 1,
    DataQualityStatus.NOT_AVAILABLE: 2,
    DataQualityStatus.UNUSABLE: 3,
}


def _worse(a: DataQualityStatus, b: DataQualityStatus) -> DataQualityStatus:
    return a if _SEVERITY[a] >= _SEVERITY[b] else b
