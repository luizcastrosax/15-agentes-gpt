"""4. Market Regime Engine (G2).

Classifica regime direcional (H4) e regime de volatilidade (M15) com base
exclusivamente em barras fechadas.

Método baseline (deliberadamente simples e auditável):

- Direção HTF: posição do fechamento em relação a EMA rápida e lenta do H4.
- Regime: TREND_UP / TREND_DOWN quando as EMAs estão ordenadas e separadas
  por ao menos 0.5 ATR; BALANCE caso contrário; EXPANSION quando a
  volatilidade está no topo da distribuição com direção definida.
- Volatilidade: percentil do ATR corrente na janela de lookback.

Limitação declarada: um classificador baseado em EMA/ATR é uma aproximação
grosseira de regime. Ele é adequado como *baseline auditável*, não como
resposta final. Substituições candidatas (variance ratio, Hurst, HMM) devem
passar pelo mesmo contrato e pelos mesmos testes de causalidade.
"""

from __future__ import annotations

from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import RegimeAssessment
from ..domain.enums import (
    Confidence,
    MarketRegime,
    TrendDirection,
    VolatilityRegime,
)
from ..domain.market import Bar
from ..domain.measurement import Measurement, MissingMeasurement
from ..features.indicators import atr, atr_percentile, ema

__all__ = ["BaselineRegimeEngine"]


class BaselineRegimeEngine:
    def assess(self, ctx: EvaluationContext) -> RegimeAssessment:
        cfg = ctx.config.regime
        htf_bars: Sequence[Bar] = ctx.snapshot.closed(cfg.htf)
        mtf_bars: Sequence[Bar] = ctx.snapshot.closed(cfg.mtf)

        notes: list[str] = []
        if not htf_bars:
            return _unknown(f"sem barras confirmadas em {cfg.htf}")
        if not mtf_bars:
            return _unknown(f"sem barras confirmadas em {cfg.mtf}")

        closes = [b.close for b in htf_bars]
        fast = ema(closes, cfg.ema_fast)
        slow = ema(closes, cfg.ema_slow)
        htf_atr = atr(htf_bars, cfg.atr_period)
        vol_pct = atr_percentile(mtf_bars, cfg.atr_period, cfg.atr_percentile_lookback)

        if fast is None or slow is None:
            return _unknown(
                f"amostra insuficiente em {cfg.htf} para EMA "
                f"({len(closes)} barras, exigidas {max(cfg.ema_fast, cfg.ema_slow)})"
            )
        if htf_atr is None:
            return _unknown(f"amostra insuficiente em {cfg.htf} para ATR")

        separation = abs(fast - slow)
        threshold = 0.5 * htf_atr.value
        last_close = closes[-1]

        if fast > slow and last_close > slow:
            direction = TrendDirection.UP
        elif fast < slow and last_close < slow:
            direction = TrendDirection.DOWN
        else:
            direction = TrendDirection.SIDEWAYS

        volatility, vol_measure = _volatility_regime(vol_pct, cfg.vol_percentile_bounds)
        if vol_pct is None:
            notes.append(
                "percentil de ATR indisponível (histórico curto): "
                "volatilidade classificada como UNKNOWN, não como NORMAL"
            )

        if direction is TrendDirection.SIDEWAYS or separation < threshold:
            regime = MarketRegime.BALANCE
        elif volatility in (VolatilityRegime.ELEVATED, VolatilityRegime.EXTREME):
            regime = MarketRegime.EXPANSION
        else:
            regime = (
                MarketRegime.TREND_UP
                if direction is TrendDirection.UP
                else MarketRegime.TREND_DOWN
            )

        confidence = Confidence.LOW
        if volatility is not VolatilityRegime.UNKNOWN:
            confidence = Confidence.MEDIUM
        if volatility is not VolatilityRegime.UNKNOWN and separation >= 1.0 * htf_atr.value:
            confidence = Confidence.HIGH

        notes.append(
            f"separação EMA={separation:.2f} pts vs limiar={threshold:.2f} pts (0.5·ATR)"
        )

        return RegimeAssessment(
            regime=regime,
            volatility=volatility,
            htf_direction=direction,
            atr=htf_atr,
            atr_percentile=vol_measure,
            basis=(cfg.htf, cfg.mtf),
            confidence=confidence,
            uses_proxy=False,
            notes=tuple(notes),
        )


def _volatility_regime(
    vol_pct: Measurement | None, bounds: tuple[float, float, float]
) -> tuple[VolatilityRegime, Measurement | MissingMeasurement]:
    if vol_pct is None:
        return VolatilityRegime.UNKNOWN, MissingMeasurement(
            reason="histórico insuficiente para percentil de ATR",
            unit="ratio",
            expected_source="atr_percentile",
        )
    low, mid, high = bounds
    v = vol_pct.value
    if v < low:
        return VolatilityRegime.COMPRESSED, vol_pct
    if v < mid:
        return VolatilityRegime.NORMAL, vol_pct
    if v < high:
        return VolatilityRegime.ELEVATED, vol_pct
    return VolatilityRegime.EXTREME, vol_pct


def _unknown(reason: str) -> RegimeAssessment:
    return RegimeAssessment(
        regime=MarketRegime.UNKNOWN,
        volatility=VolatilityRegime.UNKNOWN,
        htf_direction=TrendDirection.UNKNOWN,
        atr=MissingMeasurement(reason=reason, unit="points"),
        atr_percentile=MissingMeasurement(reason=reason, unit="ratio"),
        basis=(),
        confidence=Confidence.UNKNOWN,
        uses_proxy=False,
        notes=(reason,),
    )

