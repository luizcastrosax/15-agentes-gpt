"""Indicadores causais.

Todas as funções aqui recebem uma sequência de barras **já filtrada por
``closed_as_of``**. Elas não conhecem ``as_of`` e não podem, portanto,
introduzir look-ahead por conta própria — a responsabilidade causal fica
concentrada em quem seleciona as barras.

Todas devolvem ``Measurement`` ou ``None``. Nenhuma devolve 0.0 por falta de
amostra: amostra insuficiente é ``None``.
"""

from __future__ import annotations

from typing import Sequence

from ..domain.enums import SourceKind
from ..domain.market import Bar
from ..domain.measurement import Measurement

__all__ = [
    "true_range",
    "atr",
    "ema",
    "percentile_rank",
    "atr_percentile",
    "mean",
    "swing_points",
]


def true_range(bar: Bar, prev_close: float | None) -> float:
    if prev_close is None:
        return bar.high - bar.low
    return max(
        bar.high - bar.low,
        abs(bar.high - prev_close),
        abs(bar.low - prev_close),
    )


def atr(bars: Sequence[Bar], period: int) -> Measurement | None:
    """ATR de Wilder. ``None`` se houver menos de ``period + 1`` barras."""
    if period < 1 or len(bars) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(bars)):
        trs.append(true_range(bars[i], bars[i - 1].close))
    if len(trs) < period:
        return None
    value = sum(trs[:period]) / period
    for tr in trs[period:]:
        value = (value * (period - 1) + tr) / period
    return Measurement(
        value=value,
        unit="points",
        source=SourceKind.DERIVED,
        method=f"wilder_atr(period={period})",
        sample_size=len(trs) + 1,
    )


def ema(values: Sequence[float], period: int) -> float | None:
    if period < 1 or len(values) < period:
        return None
    k = 2.0 / (period + 1.0)
    out = sum(values[:period]) / period
    for v in values[period:]:
        out = v * k + out * (1 - k)
    return out


def mean(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def percentile_rank(values: Sequence[float], target: float) -> float | None:
    """Fração de ``values`` <= ``target``. ``None`` se a amostra for vazia."""
    if not values:
        return None
    below = sum(1 for v in values if v <= target)
    return below / len(values)


def atr_percentile(bars: Sequence[Bar], period: int, lookback: int) -> Measurement | None:
    """Percentil do ATR atual dentro da janela ``lookback``.

    Implementação intencionalmente simples e O(n·period): clareza e
    auditabilidade valem mais que microtempo no MVP. A janela é rolada sobre
    barras fechadas apenas.
    """
    if len(bars) < period + lookback + 1:
        return None
    current = atr(bars, period)
    if current is None:
        return None
    history: list[float] = []
    for end in range(len(bars) - lookback, len(bars) + 1):
        window = bars[max(0, end - (period + 1) * 3) : end]
        m = atr(window, period)
        if m is not None:
            history.append(m.value)
    if len(history) < max(5, lookback // 4):
        return None
    rank = percentile_rank(history, current.value)
    if rank is None:
        return None
    return Measurement(
        value=rank,
        unit="ratio",
        source=SourceKind.DERIVED,
        method=f"atr_percentile(period={period}, lookback={lookback})",
        sample_size=len(history),
    )


def swing_points(bars: Sequence[Bar], lookback: int) -> tuple[list[int], list[int]]:
    """Índices de swing highs e swing lows **confirmados**.

    Um pivô no índice ``i`` só é confirmado se existirem ``lookback`` barras
    fechadas depois dele. Por isso o laço termina em ``len(bars) - lookback``:
    é essa borda que impede o repaint clássico de pivôs.
    """
    highs: list[int] = []
    lows: list[int] = []
    if lookback < 1 or len(bars) < 2 * lookback + 1:
        return highs, lows
    for i in range(lookback, len(bars) - lookback):
        window = bars[i - lookback : i + lookback + 1]
        pivot = bars[i]
        if all(pivot.high >= b.high for b in window) and any(
            pivot.high > b.high for b in window
        ):
            highs.append(i)
        if all(pivot.low <= b.low for b in window) and any(pivot.low < b.low for b in window):
            lows.append(i)
    return highs, lows
