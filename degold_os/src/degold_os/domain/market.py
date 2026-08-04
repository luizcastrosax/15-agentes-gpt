"""Modelos de mercado: instrumento, barra, série e snapshot de book.

Invariantes de causalidade impostas aqui (não por convenção, por construção):

- ``Bar`` é imutável e carrega ``EventTiming``. Uma barra só é *usável* quando
  ``timing.available_at <= as_of``, isto é: depois de fechada e ingerida.
- ``BarSeries.closed_as_of(as_of)`` é o **único** acessor permitido para
  features. Ele filtra por ``available_at``, então uma barra em formação nunca
  vaza para o cálculo.
- ``BarSeries`` é append-only e valida ordenação estrita no append. Reescrever
  uma barra já confirmada levanta ``CausalityViolation``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable, Iterator, Sequence

from .enums import Timeframe, TIMEFRAME_SECONDS
from .errors import CausalityViolation, ContractViolation
from .timing import EventTiming, ensure_utc

__all__ = ["Instrument", "Bar", "BarSeries", "QuoteSnapshot", "MarketSnapshot"]


@dataclass(frozen=True, slots=True)
class Instrument:
    """Contrato negociado.

    Os valores default correspondem ao MNQ (Micro E-mini Nasdaq-100) e são
    sobrescritos pelo arquivo de configuração ``config/instruments/mnq.json``.
    Nenhum valor aqui é "descoberto" em runtime: sem configuração, o sistema
    recusa iniciar (fail-closed).
    """

    symbol: str
    tick_size: float
    #: USD por 1.0 ponto de índice.
    point_value: float
    currency: str = "USD"
    exchange: str = ""
    description: str = ""

    def __post_init__(self) -> None:
        if self.tick_size <= 0:
            raise ContractViolation("tick_size deve ser > 0")
        if self.point_value <= 0:
            raise ContractViolation("point_value deve ser > 0")

    @property
    def tick_value(self) -> float:
        """USD por tick."""
        return self.tick_size * self.point_value

    def round_to_tick(self, price: float) -> float:
        """Arredonda para o múltiplo de tick mais próximo."""
        return round(round(price / self.tick_size) * self.tick_size, 10)

    def ticks_between(self, a: float, b: float) -> float:
        return abs(a - b) / self.tick_size

    def money(self, points: float, quantity: int = 1) -> float:
        """Converte pontos de índice em USD para ``quantity`` contratos."""
        return points * self.point_value * quantity


@dataclass(frozen=True, slots=True)
class Bar:
    """Barra OHLCV fechada (ou em formação, se ``timing.confirmed_at is None``).

    ``open_time`` é o início do intervalo; ``close_time`` é o fim exclusivo
    (``open_time + duração do timeframe``). Um sistema causal precisa desta
    distinção: usar ``open_time`` como carimbo de disponibilidade é a forma
    mais comum de look-ahead em backtests.
    """

    timeframe: Timeframe
    open_time: datetime
    close_time: datetime
    open: float
    high: float
    low: float
    close: float
    #: Volume negociado. ``None`` = não disponível (jamais 0 por default).
    volume: float | None
    timing: EventTiming

    def __post_init__(self) -> None:
        object.__setattr__(self, "open_time", ensure_utc(self.open_time))
        object.__setattr__(self, "close_time", ensure_utc(self.close_time))
        if self.close_time <= self.open_time:
            raise ContractViolation("close_time deve ser > open_time")
        expected = timedelta(seconds=TIMEFRAME_SECONDS[self.timeframe])
        if self.close_time - self.open_time != expected:
            raise ContractViolation(
                f"duração da barra {self.close_time - self.open_time} "
                f"não bate com o timeframe {self.timeframe} ({expected})"
            )
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ContractViolation(
                f"OHLC incoerente: o={self.open} h={self.high} l={self.low} c={self.close}"
            )
        if self.high < self.low:
            raise ContractViolation("high < low")
        if self.volume is not None and self.volume < 0:
            raise ContractViolation("volume negativo")
        if self.timing.confirmed_at is not None and self.timing.confirmed_at < self.close_time:
            raise CausalityViolation(
                "barra não pode ser confirmada antes do próprio close_time"
            )

    # -- geometria ---------------------------------------------------------

    @property
    def range(self) -> float:
        return self.high - self.low

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def is_bullish(self) -> bool:
        return self.close > self.open

    @property
    def is_bearish(self) -> bool:
        return self.close < self.open

    def body_ratio(self) -> float | None:
        """Corpo / range. ``None`` quando range == 0 (nunca 0.0 por default)."""
        if self.range == 0:
            return None
        return self.body / self.range

    def close_position_in_range(self) -> float | None:
        """0.0 = fechou na mínima, 1.0 = fechou na máxima. ``None`` se range==0."""
        if self.range == 0:
            return None
        return (self.close - self.low) / self.range

    def to_dict(self) -> dict[str, object]:
        return {
            "timeframe": str(self.timeframe),
            "open_time": self.open_time.isoformat(),
            "close_time": self.close_time.isoformat(),
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "timing": self.timing.to_dict(),
        }


class BarSeries:
    """Série append-only de barras de um único timeframe.

    Não é um ``dataclass`` porque encapsula a invariante de append-only, que
    seria trivialmente violável com atribuição direta ao campo.
    """

    __slots__ = ("timeframe", "_bars")

    def __init__(self, timeframe: Timeframe, bars: Iterable[Bar] = ()) -> None:
        self.timeframe = timeframe
        self._bars: list[Bar] = []
        for bar in bars:
            self.append(bar)

    # -- construção --------------------------------------------------------

    def append(self, bar: Bar) -> None:
        if bar.timeframe is not self.timeframe:
            raise ContractViolation(
                f"barra {bar.timeframe} não pertence à série {self.timeframe}"
            )
        if self._bars:
            last = self._bars[-1]
            if bar.open_time < last.open_time:
                raise CausalityViolation(
                    "barra fora de ordem: histórico confirmado não é reescrito "
                    f"({bar.open_time.isoformat()} < {last.open_time.isoformat()})"
                )
            if bar.open_time == last.open_time:
                raise CausalityViolation(
                    "barra duplicada: reescrita de histórico confirmado é proibida "
                    f"({bar.open_time.isoformat()})"
                )
        self._bars.append(bar)

    # -- acesso causal -----------------------------------------------------

    def closed_as_of(self, as_of: datetime) -> Sequence[Bar]:
        """Barras **confirmadas e disponíveis** em ``as_of``.

        Este é o único acessor que features e engines devem usar.
        """
        as_of = ensure_utc(as_of)
        return tuple(b for b in self._bars if b.timing.confirmed_visible_at(as_of))

    def last_closed(self, as_of: datetime, count: int = 1) -> Sequence[Bar]:
        bars = self.closed_as_of(as_of)
        if count <= 0:
            raise ContractViolation("count deve ser >= 1")
        return bars[-count:]

    def forming_at(self, as_of: datetime) -> Bar | None:
        """Barra em formação em ``as_of`` — exposta apenas para telemetria.

        Nenhuma feature causal pode consumi-la; ela existe para permitir
        registrar o contexto real do instante da decisão nos logs.
        """
        as_of = ensure_utc(as_of)
        for bar in reversed(self._bars):
            if bar.open_time <= as_of < bar.close_time:
                return bar
        return None

    # -- protocolo de sequência -------------------------------------------

    def __len__(self) -> int:
        return len(self._bars)

    def __iter__(self) -> Iterator[Bar]:
        return iter(self._bars)

    def __repr__(self) -> str:  # pragma: no cover - debug
        return f"BarSeries({self.timeframe}, n={len(self._bars)})"


@dataclass(frozen=True, slots=True)
class QuoteSnapshot:
    """Snapshot de topo de livro.

    Todos os campos são ``Optional``: em uma fonte apenas OHLCV, não há bid/ask.
    Nesse caso o spread é tratado como ``NOT_AVAILABLE`` ou estimado por proxy
    **rotulado**, jamais assumido como zero.
    """

    ts: datetime
    bid: float | None = None
    ask: float | None = None
    bid_size: float | None = None
    ask_size: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "ts", ensure_utc(self.ts))

    @property
    def spread(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return self.ask - self.bid

    @property
    def mid(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return (self.bid + self.ask) / 2.0


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    """Todo o dado de mercado visível ao sistema em um instante.

    É o *input bruto* do pipeline. Os engines nunca leem I/O: recebem este
    objeto, o que torna cada decisão reprodutível a partir dele.
    """

    instrument: Instrument
    as_of: datetime
    series: dict[Timeframe, BarSeries] = field(default_factory=dict)
    quote: QuoteSnapshot | None = None
    #: Metadados de saúde do feed, preenchidos pelo adapter de dados.
    feed_last_message_at: datetime | None = None
    feed_name: str = "unknown"

    def __post_init__(self) -> None:
        object.__setattr__(self, "as_of", ensure_utc(self.as_of))
        if self.feed_last_message_at is not None:
            object.__setattr__(
                self, "feed_last_message_at", ensure_utc(self.feed_last_message_at)
            )

    def get(self, tf: Timeframe) -> BarSeries | None:
        return self.series.get(tf)

    def closed(self, tf: Timeframe) -> Sequence[Bar]:
        """Barras confirmadas do timeframe em ``self.as_of``; vazio se ausente."""
        s = self.series.get(tf)
        if s is None:
            return ()
        return s.closed_as_of(self.as_of)
