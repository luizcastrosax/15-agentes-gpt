"""Fixtures sintéticas.

IMPORTANTE — o que estes dados são e o que não são
--------------------------------------------------
São séries **construídas à mão** para exercitar caminhos de código: um sweep
de PDH rejeitado, com estrutura e fluxo alinhados. Elas não representam
comportamento real do MNQ, não vêm de nenhum fornecedor e não sustentam
nenhuma conclusão sobre lucratividade. Servem apenas para verificar que o
pipeline decide o que deveria decidir, dado um cenário conhecido.

A configuração de teste é uma versão reduzida da de produção (menos barras
mínimas, períodos menores) para manter os testes rápidos. Os limiares de
comportamento (penetração, aceitação, R:R, risco) são os mesmos.
"""

from __future__ import annotations

import copy
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from degold_os.adapters.market_data import ReplaySource, resample
from degold_os.configuration.loader import DEFAULT_CONFIG_PATH, build_config
from degold_os.configuration.models import DeGoldConfig
from degold_os.contracts.context import EvaluationContext
from degold_os.domain.account import AccountState, PositionSnapshot, SessionRiskLedger
from degold_os.domain.enums import PositionState, Timeframe
from degold_os.domain.market import Bar, BarSeries, QuoteSnapshot
from degold_os.domain.timing import AsOf, EventTiming

UTC = timezone.utc
TICK = 0.25
LATENCY_MS = 250

#: Instante da decisão no cenário feliz (terça-feira, 09:43 ET / EDT = UTC-4).
DECISION_AT = datetime(2026, 6, 2, 13, 43, 0, 250_000, tzinfo=UTC)

#: Nível de liquidez varrido: máxima do dia anterior.
PDH = 21000.00
#: Extremo da penetração (high da barra que varre o PDH).
SWEEP_HIGH = 21001.25

_DAY1_START = datetime(2026, 6, 1, 13, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Configuração de teste
# ---------------------------------------------------------------------------

_TEST_OVERRIDES: Mapping[str, Any] = {
    "data_quality": {
        "required_timeframes": ["H4", "M15", "M5", "M2", "M1"],
        "min_bars": {"H4": 20, "M15": 30, "M5": 30, "M2": 30, "M1": 30},
        "max_staleness_multiple": 3.0,
        "max_feed_staleness_seconds": 90,
    },
    "regime": {
        "htf": "H4",
        "mtf": "M15",
        "atr_period": 5,
        "atr_percentile_lookback": 20,
        "ema_fast": 5,
        "ema_slow": 10,
        "vol_percentile_bounds": [0.2, 0.6, 0.9],
        "allowed_regimes": ["TREND_UP", "TREND_DOWN", "BALANCE"],
    },
    "flow": {
        "timeframe": "M1",
        "lookback_bars": 20,
        "min_volume_ratio": 1.2,
        "allow_proxy": True,
    },
}


def test_config(**sections: Mapping[str, Any]) -> DeGoldConfig:
    """Config de produção com overrides de teste e overrides pontuais."""
    raw = json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
    raw = copy.deepcopy(raw)
    for key, value in _TEST_OVERRIDES.items():
        raw[key] = copy.deepcopy(value)
    for key, value in sections.items():
        merged = dict(raw.get(key, {}))
        merged.update(value)
        raw[key] = merged
    return build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def shadow_ready_config(**sections: Mapping[str, Any]) -> DeGoldConfig:
    """Config no estágio SHADOW_MODE — o único que permite SHADOW_INTENT."""
    base = {
        "runtime": {
            "execution_mode": "SHADOW",
            "code_version": "0.1.0",
            "ruleset_version": "2026.08.0",
            "ingestion_latency_ms": LATENCY_MS,
        },
        "maturity": {
            "setup_id": "mnq_sweep_rejection_v1",
            "stage": "SHADOW_MODE",
            "oos_completed": True,
            "walk_forward_completed": True,
            "sample_size": 120,
            "historical_confidence": 0.44,
            "evidence_ref": "artifacts/reports/FICTICIO-apenas-para-teste.md",
            "min_stage_for_shadow": "SHADOW_MODE",
        },
        "telemetry": {
            "enabled": False,
            "sink": "null",
            "path": None,
            "log_all_decisions": False,
        },
    }
    base.update({k: dict(v) for k, v in sections.items()})
    return test_config(**base)


# ---------------------------------------------------------------------------
# Construção de barras
# ---------------------------------------------------------------------------


def q(price: float) -> float:
    """Quantiza no tick do MNQ."""
    return round(round(price / TICK) * TICK, 4)


def make_bar(
    timeframe: Timeframe,
    open_time: datetime,
    o: float,
    h: float,
    lo: float,
    c: float,
    volume: float | None = 100.0,
    latency_ms: int = LATENCY_MS,
) -> Bar:
    close_time = open_time + timedelta(
        seconds={"H4": 14400, "M15": 900, "M5": 300, "M2": 120, "M1": 60}[str(timeframe)]
    )
    return Bar(
        timeframe=timeframe,
        open_time=open_time,
        close_time=close_time,
        open=q(o),
        high=q(h),
        low=q(lo),
        close=q(c),
        volume=volume,
        timing=EventTiming.confirmed_now(
            detected_at=close_time,
            confirmed_at=close_time,
            ingestion_latency=timedelta(milliseconds=latency_ms),
        ),
    )


def _m1_path() -> list[tuple[datetime, float, float, float, float, float]]:
    """Caminho M1 determinístico do cenário: acumulação, sweep do PDH, rejeição.

    Retorna tuplas ``(open_time, open, high, low, close, volume)``. Toda a
    geometria relevante ao teste é explícita — nada é aleatório.
    """
    rows: list[tuple[datetime, float, float, float, float, float]] = []
    t = _DAY1_START
    price = 20940.0

    # --- Dia 1: 13:00 -> 20:00 UTC, oscilação com máxima exata no PDH -------
    day1_minutes = 7 * 60
    for i in range(day1_minutes):
        # Sobe até o PDH no meio do dia e recua — a máxima do dia é o PDH.
        phase = i / day1_minutes
        target = 20940.0 + 60.0 * (1 - abs(2 * phase - 1))
        o = price
        c = target
        if i == day1_minutes // 2:
            c = PDH - 3.0  # a barra que marca a máxima do dia fecha abaixo dela
        hi = min(max(o, c) + 1.0, PDH)
        lo = min(o, c) - 1.0
        if i == day1_minutes // 2:
            hi = PDH  # máxima do dia, exata
        rows.append((t, o, hi, lo, c, 100.0))
        price = c
        t += timedelta(minutes=1)

    # --- Noite: 20:00 (dia 1) -> 12:00 (dia 2) UTC, oscilação abaixo do PDH -
    # A amplitude é escolhida para que a volatilidade da noite seja comparável
    # à do dia: sem isso o percentil de ATR do M15 satura e o regime vira
    # EXPANSION artificialmente.
    night_minutes = 16 * 60
    for i in range(night_minutes):
        o = price
        c = 20964.0 + 14.0 * math.sin(i / 28.0)
        rows.append((t, o, max(o, c) + 1.0, min(o, c) - 1.0, c, 80.0))
        price = c
        t += timedelta(minutes=1)

    # --- Dia 2, 12:00 -> 13:22 UTC: aproximação, máxima local 20998 ---------
    approach_minutes = 82  # 12:00..13:21
    for k in range(approach_minutes):
        o = price
        c = 20978.0 + (20997.0 - 20978.0) * (k / max(1, approach_minutes - 1))
        hi = max(o, c) + 1.0
        lo = min(o, c) - 1.0
        rows.append((t, o, min(hi, 20998.0), lo, c, 90.0))
        price = c
        t += timedelta(minutes=1)

    # --- 13:22 -> 13:26: pullback que cria o swing low estrutural (20996) ---
    for c in (20996.5, 20996.0, 20996.0, 20996.75):
        o = price
        rows.append((t, o, max(o, c) + 0.5, min(o, c) - 0.5, c, 90.0))
        price = c
        t += timedelta(minutes=1)

    # --- 13:26 -> 13:30: retoma para cima (confirma o pivô de mínima) -------
    for c in (20997.5, 20998.0, 20998.5, 20999.0):
        o = price
        rows.append((t, o, max(o, c) + 0.5, min(o, c) - 0.5, c, 95.0))
        price = c
        t += timedelta(minutes=1)

    # --- 13:30 -> 13:35: barra M5 que varre o PDH e fecha abaixo ------------
    sweep_m1 = [
        (20999.5, 21000.5, 20999.0, 21000.25),
        (21000.25, SWEEP_HIGH, 20999.75, 21000.5),  # extremo da penetração
        (21000.5, 21000.75, 20998.5, 20999.0),
        (20999.0, 20999.25, 20997.0, 20997.5),
        (20997.5, 20997.75, 20996.5, 20997.0),  # M5 fecha abaixo do PDH
    ]
    for o, hi, lo, c in sweep_m1:
        rows.append((t, o, hi, lo, c, 150.0))
        price = c
        t += timedelta(minutes=1)

    # --- 13:35 -> 13:40: barra M5 de confirmação, fecha abaixo do PDH -------
    for c in (20996.5, 20996.25, 20996.0, 20995.75, 20995.5):
        o = price
        rows.append((t, o, max(o, c) + 0.5, min(o, c) - 0.25, c, 120.0))
        price = c
        t += timedelta(minutes=1)

    # --- 13:40 -> 13:43: janela de aceitação (3 barras M1) ------------------
    # 13:40->13:41 e 13:41->13:42 fecham abaixo do nível; a última tem pavio
    # superior de rejeição e fecha abaixo do swing low estrutural (20996).
    rows.append((t, price, price + 0.5, 20995.0, 20995.25, 130.0))
    t += timedelta(minutes=1)
    rows.append((t, 20995.25, 20995.75, 20994.75, 20995.0, 140.0))
    t += timedelta(minutes=1)
    rows.append((t, 20995.0, 20998.0, 20994.0, 20994.5, 600.0))  # rejeição + volume
    t += timedelta(minutes=1)

    return rows


def build_series(latency_ms: int = LATENCY_MS) -> dict[Timeframe, BarSeries]:
    """Constrói M1 e deriva M2/M5/M15; H4 é gerado em grade própria."""
    m1 = BarSeries(Timeframe.M1)
    for open_time, o, hi, lo, c, vol in _m1_path():
        m1.append(make_bar(Timeframe.M1, open_time, o, hi, lo, c, vol, latency_ms))

    series: dict[Timeframe, BarSeries] = {Timeframe.M1: m1}
    for tf in (Timeframe.M2, Timeframe.M5, Timeframe.M15):
        series[tf] = resample(m1, tf, latency_ms)
    series[Timeframe.H4] = _h4_series(latency_ms)
    return series


def _h4_series(latency_ms: int) -> BarSeries:
    """H4 contínuo terminando em 12:00 UTC do dia 2, em tendência de alta suave."""
    s = BarSeries(Timeframe.H4)
    end = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    count = 40
    start = end - timedelta(hours=4 * count)
    price = 20600.0
    t = start
    for i in range(count):
        o = price
        c = price + 9.0
        hi = c + 12.0
        lo = o - 10.0
        s.append(make_bar(Timeframe.H4, t, o, hi, lo, c, 5000.0, latency_ms))
        price = c
        t += timedelta(hours=4)
    return s


# ---------------------------------------------------------------------------
# Contexto pronto
# ---------------------------------------------------------------------------


def healthy_account(as_of: datetime = DECISION_AT) -> AccountState:
    return AccountState(equity=50_000.0, currency="USD", as_of=as_of, broker="fixture")


def flat_position(as_of: datetime = DECISION_AT) -> PositionSnapshot:
    return PositionSnapshot(state=PositionState.FLAT, as_of=as_of, position=None)


def clean_ledger() -> SessionRiskLedger:
    return SessionRiskLedger(
        session_date="2026-06-02",
        realized_pnl=0.0,
        trades_taken=0,
        consecutive_losses=0,
        open_risk=0.0,
    )


#: Sentinela para distinguir "não informado" de "explicitamente ausente".
#: Sem isso, ``account=None`` significaria "use o default", e seria impossível
#: testar o caminho fail-closed de estado desconhecido — exatamente o caminho
#: que mais importa verificar.
UNSET: Any = object()


def make_context(
    config: DeGoldConfig | None = None,
    as_of: datetime = DECISION_AT,
    *,
    series: dict[Timeframe, BarSeries] | None = None,
    macro_events: Iterable[Any] | None = (),
    account: AccountState | None = UNSET,
    position: PositionSnapshot | None = UNSET,
    ledger: SessionRiskLedger | None = UNSET,
    with_quote: bool = False,
) -> EvaluationContext:
    cfg = config or shadow_ready_config()
    src = ReplaySource(cfg.instrument, series or build_series(cfg.runtime.ingestion_latency_ms))
    quote = None
    if with_quote:
        quote = QuoteSnapshot(ts=as_of, bid=20994.25, ask=20994.5, bid_size=10, ask_size=12)
    snapshot = src.snapshot_at(as_of, quote=quote)
    return EvaluationContext(
        as_of=AsOf(as_of),
        snapshot=snapshot,
        config=cfg,
        macro_events=None if macro_events is None else tuple(macro_events),
        account=healthy_account(as_of) if account is UNSET else account,
        position=flat_position(as_of) if position is UNSET else position,
        risk_ledger=clean_ledger() if ledger is UNSET else ledger,
        meta={"fixture": "sweep_rejection_short"},
    )


def write_csv(series: BarSeries, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["open_time,open,high,low,close,volume"]
    for b in series:
        vol = "" if b.volume is None else f"{b.volume:g}"
        lines.append(
            f"{b.open_time.isoformat()},{b.open},{b.high},{b.low},{b.close},{vol}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def build_extended_series(
    extra_minutes: int = 40, drift_per_minute: float = 1.5, latency_ms: int = LATENCY_MS
) -> dict[Timeframe, BarSeries]:
    """Mesmo cenário, com barras **posteriores** ao instante de decisão.

    O prolongamento é deliberadamente adversarial: o preço dispara para cima,
    acima do nível varrido. Se qualquer feature enxergasse o futuro, a decisão
    em ``DECISION_AT`` mudaria — é exatamente isso que os testes de causalidade
    verificam que **não** acontece.
    """
    rows = _m1_path()
    t = rows[-1][0] + timedelta(minutes=1)
    price = rows[-1][4]
    for _ in range(extra_minutes):
        o = price
        c = o + drift_per_minute
        rows.append((t, o, c + 1.0, o - 0.5, c, 400.0))
        price = c
        t += timedelta(minutes=1)

    m1 = BarSeries(Timeframe.M1)
    for open_time, o, hi, lo, c, vol in rows:
        m1.append(make_bar(Timeframe.M1, open_time, o, hi, lo, c, vol, latency_ms))
    series: dict[Timeframe, BarSeries] = {Timeframe.M1: m1}
    for tf in (Timeframe.M2, Timeframe.M5, Timeframe.M15):
        series[tf] = resample(m1, tf, latency_ms)
    series[Timeframe.H4] = _h4_series(latency_ms)
    return series


def comparable(record) -> dict:
    """DecisionRecord sem campos de medição de tempo de execução."""
    d = record.to_dict()
    d.pop("eval_ms", None)
    return d
