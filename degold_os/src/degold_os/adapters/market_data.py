"""Adaptadores de dados de mercado: leitura, agregação e replay causal.

Este módulo **não** busca dados de nenhum fornecedor. Ele lê arquivos que
você forneça e os transforma em ``BarSeries`` com carimbos causais corretos.
Nenhum endpoint, símbolo de vendor ou credencial é presumido aqui.

Formato CSV esperado (cabeçalho obrigatório)::

    open_time,open,high,low,close,volume

``open_time`` em ISO-8601 com fuso (ex.: ``2026-03-02T13:30:00+00:00``).
``volume`` pode ser vazio — vazio vira ``None`` (ausente), **não** zero.

Agregação (``resample``) só emite buckets **completos**: um bucket parcial
no fim da série é descartado. Emitir bucket parcial como barra fechada é a
forma mais direta de contaminar um backtest com informação futura.
"""

from __future__ import annotations

import csv
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Iterator, Sequence

from ..domain.enums import TIMEFRAME_SECONDS, Timeframe
from ..domain.errors import DataQualityError
from ..domain.market import Bar, BarSeries, Instrument, MarketSnapshot, QuoteSnapshot
from ..domain.timing import EventTiming, ensure_utc

__all__ = ["load_bars_csv", "bars_from_rows", "resample", "ReplaySource"]


def _mk_bar(
    timeframe: Timeframe,
    open_time: datetime,
    o: float,
    h: float,
    l: float,  # noqa: E741 - "low" é l por simetria com OHLC
    c: float,
    volume: float | None,
    latency: timedelta,
) -> Bar:
    open_time = ensure_utc(open_time)
    close_time = open_time + timedelta(seconds=TIMEFRAME_SECONDS[timeframe])
    return Bar(
        timeframe=timeframe,
        open_time=open_time,
        close_time=close_time,
        open=o,
        high=h,
        low=l,
        close=c,
        volume=volume,
        timing=EventTiming.confirmed_now(
            detected_at=close_time, confirmed_at=close_time, ingestion_latency=latency
        ),
    )


def bars_from_rows(
    rows: Iterable[Sequence[str]],
    timeframe: Timeframe,
    ingestion_latency_ms: int = 0,
) -> BarSeries:
    latency = timedelta(milliseconds=ingestion_latency_ms)
    series = BarSeries(timeframe)
    for i, row in enumerate(rows, start=2):
        if len(row) < 5:
            raise DataQualityError(f"linha {i}: colunas insuficientes ({len(row)})")
        raw_volume = row[5].strip() if len(row) > 5 else ""
        series.append(
            _mk_bar(
                timeframe=timeframe,
                open_time=datetime.fromisoformat(row[0].strip()),
                o=float(row[1]),
                h=float(row[2]),
                l=float(row[3]),
                c=float(row[4]),
                volume=(float(raw_volume) if raw_volume else None),
                latency=latency,
            )
        )
    return series


def load_bars_csv(
    path: str | Path, timeframe: Timeframe, ingestion_latency_ms: int = 0
) -> BarSeries:
    p = Path(path)
    if not p.exists():
        raise DataQualityError(f"arquivo de barras não encontrado: {p}")
    with p.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None:
            raise DataQualityError(f"arquivo vazio: {p}")
        expected = ["open_time", "open", "high", "low", "close"]
        if [h.strip().lower() for h in header[:5]] != expected:
            raise DataQualityError(
                f"cabeçalho inesperado em {p}: {header[:5]} (esperado {expected})"
            )
        return bars_from_rows(list(reader), timeframe, ingestion_latency_ms)


def resample(
    source: BarSeries, target: Timeframe, ingestion_latency_ms: int = 0
) -> BarSeries:
    """Agrega uma série para um timeframe maior, emitindo só buckets completos."""
    src_sec = TIMEFRAME_SECONDS[source.timeframe]
    tgt_sec = TIMEFRAME_SECONDS[target]
    if tgt_sec <= src_sec:
        raise DataQualityError(
            f"resample exige timeframe maior: {source.timeframe} -> {target}"
        )
    if tgt_sec % src_sec != 0:
        raise DataQualityError(
            f"{target} não é múltiplo inteiro de {source.timeframe}"
        )
    factor = tgt_sec // src_sec
    latency = timedelta(milliseconds=ingestion_latency_ms)
    out = BarSeries(target)

    bucket: list[Bar] = []
    bucket_start: datetime | None = None
    for bar in source:
        epoch = int(bar.open_time.timestamp())
        start_epoch = epoch - (epoch % tgt_sec)
        start = datetime.fromtimestamp(start_epoch, tz=bar.open_time.tzinfo)
        if bucket_start is None:
            bucket_start = start
        if start != bucket_start:
            _flush(out, bucket, bucket_start, target, factor, latency)
            bucket = []
            bucket_start = start
        bucket.append(bar)
    # O último bucket só entra se estiver completo.
    if bucket and bucket_start is not None:
        _flush(out, bucket, bucket_start, target, factor, latency)
    return out


def _flush(
    out: BarSeries,
    bucket: list[Bar],
    start: datetime,
    target: Timeframe,
    factor: int,
    latency: timedelta,
) -> None:
    if len(bucket) != factor:
        # Bucket incompleto (gap de dados ou cauda da série): descartado.
        return
    volumes = [b.volume for b in bucket]
    volume = None if any(v is None for v in volumes) else sum(v for v in volumes if v is not None)
    out.append(
        _mk_bar(
            timeframe=target,
            open_time=start,
            o=bucket[0].open,
            h=max(b.high for b in bucket),
            l=min(b.low for b in bucket),
            c=bucket[-1].close,
            volume=volume,
            latency=latency,
        )
    )


class ReplaySource:
    """Fonte de replay causal para backtest e testes.

    ``snapshot_at`` constrói um ``MarketSnapshot`` contendo **apenas** as
    barras já disponíveis em ``as_of``. Isso é redundante em relação a
    ``BarSeries.closed_as_of`` — e a redundância é proposital: defesa em
    profundidade contra look-ahead, com os dois mecanismos verificados
    independentemente pelos testes de causalidade.
    """

    __slots__ = ("instrument", "series", "feed_name")

    def __init__(
        self,
        instrument: Instrument,
        series: dict[Timeframe, BarSeries],
        feed_name: str = "replay",
    ) -> None:
        self.instrument = instrument
        self.series = series
        self.feed_name = feed_name

    def snapshot_at(
        self, as_of: datetime, quote: QuoteSnapshot | None = None
    ) -> MarketSnapshot:
        as_of = ensure_utc(as_of)
        truncated: dict[Timeframe, BarSeries] = {}
        last_close: datetime | None = None
        for tf, s in self.series.items():
            visible = s.closed_as_of(as_of)
            truncated[tf] = BarSeries(tf, visible)
            if visible:
                candidate = visible[-1].close_time
                last_close = candidate if last_close is None else max(last_close, candidate)
        return MarketSnapshot(
            instrument=self.instrument,
            as_of=as_of,
            series=truncated,
            quote=quote,
            feed_last_message_at=last_close,
            feed_name=self.feed_name,
        )

    def decision_times(self, timeframe: Timeframe) -> Iterator[datetime]:
        """Instantes de decisão: o fechamento de cada barra do timeframe dado.

        Decidir no fechamento (e não no meio) é o que torna o backtest
        replicável em produção: em produção, é exatamente aí que o dado chega.
        """
        s = self.series.get(timeframe)
        if s is None:
            return iter(())
        return (b.timing.available_at for b in s)
