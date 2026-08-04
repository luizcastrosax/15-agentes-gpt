"""Configuração, adaptadores de dados, broker e telemetria."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone

import fixtures as F
import pytest

from degold_os.adapters.broker_shadow import ReadOnlyBrokerAdapter, ShadowBrokerAdapter
from degold_os.adapters.macro_calendar import load_macro_events
from degold_os.adapters.market_data import ReplaySource, load_bars_csv, resample
from degold_os.configuration.loader import DEFAULT_CONFIG_PATH, build_config, load_config
from degold_os.domain.enums import Decision, ExecutionMode, GateId, GateStatus, Timeframe
from degold_os.domain.errors import (
    ConfigurationError,
    DataQualityError,
    ExecutionModeViolation,
)
from degold_os.domain.decision import DecisionRecord, GateEvaluation, GateResult
from degold_os.domain.enums import SessionPhase
from degold_os.telemetry.metrics import aggregate
from degold_os.telemetry.sinks import JsonlTelemetrySink, build_sink

UTC = timezone.utc


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------


def _raw() -> dict:
    return copy.deepcopy(json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")))


def test_default_config_loads_and_is_read_only():
    cfg = load_config()
    assert cfg.runtime.execution_mode is ExecutionMode.READ_ONLY
    assert cfg.instrument.symbol == "MNQ"
    assert cfg.config_hash


def test_missing_section_aborts_boot():
    raw = _raw()
    del raw["risk"]
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def test_missing_risk_key_aborts_boot():
    raw = _raw()
    del raw["risk"]["daily_loss_limit_pct"]
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def test_engine_timeframe_absent_from_required_is_rejected():
    raw = _raw()
    raw["data_quality"]["required_timeframes"] = ["M15", "M5", "M2", "M1"]
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def test_absurd_risk_is_rejected():
    raw = _raw()
    raw["risk"]["max_risk_pct_per_trade"] = 50.0
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def test_historical_confidence_without_validation_is_rejected():
    raw = _raw()
    raw["maturity"]["historical_confidence"] = 0.7
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


def test_config_hash_changes_with_content():
    a = load_config()
    raw = _raw()
    raw["execution"]["target_r_multiple"] = 3.0
    b = build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)
    assert a.config_hash != b.config_hash


def test_invalid_session_window_format_is_rejected():
    raw = _raw()
    raw["session"]["windows"][0]["start"] = "25:00"
    with pytest.raises(ConfigurationError):
        build_config(raw, base_dir=DEFAULT_CONFIG_PATH.parent)


# ---------------------------------------------------------------------------
# Dados de mercado
# ---------------------------------------------------------------------------


def test_resample_produces_expected_counts():
    series = F.build_series()
    m1 = series[Timeframe.M1]
    m5 = resample(m1, Timeframe.M5)
    assert len(m5) == len(m1) // 5


def test_resample_discards_incomplete_trailing_bucket():
    series = F.build_series()
    m1 = series[Timeframe.M1]
    m5 = resample(m1, Timeframe.M5)
    last_m5 = list(m5)[-1]
    assert last_m5.close_time <= list(m1)[-1].close_time


def test_resample_refuses_smaller_target():
    series = F.build_series()
    with pytest.raises(DataQualityError):
        resample(series[Timeframe.M5], Timeframe.M1)


def test_resample_volume_is_none_when_any_source_volume_missing():
    from degold_os.domain.market import BarSeries

    base = list(F.build_series()[Timeframe.M1])[:10]
    holed = BarSeries(Timeframe.M1)
    for i, b in enumerate(base):
        holed.append(
            F.make_bar(
                Timeframe.M1,
                b.open_time,
                b.open,
                b.high,
                b.low,
                b.close,
                None if i == 0 else 100.0,
            )
        )
    m2 = resample(holed, Timeframe.M2)
    assert list(m2)[0].volume is None


def test_csv_roundtrip(tmp_path):
    series = F.build_series()[Timeframe.M5]
    path = F.write_csv(series, tmp_path / "M5.csv")
    loaded = load_bars_csv(path, Timeframe.M5, 250)
    assert len(loaded) == len(series)
    assert list(loaded)[0].close == list(series)[0].close


def test_csv_with_bad_header_is_rejected(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("t,o,h,l,c\n", encoding="utf-8")
    with pytest.raises(DataQualityError):
        load_bars_csv(p, Timeframe.M5)


def test_replay_snapshot_is_truncated_at_as_of():
    series = F.build_extended_series()
    src = ReplaySource(load_config().instrument, series)
    snap = src.snapshot_at(F.DECISION_AT)
    for tf, s in snap.series.items():
        assert all(b.timing.available_at <= F.DECISION_AT for b in s)


# ---------------------------------------------------------------------------
# Calendário macro
# ---------------------------------------------------------------------------


def test_absent_calendar_file_returns_none(tmp_path):
    assert load_macro_events(tmp_path / "inexistente.json") is None
    assert load_macro_events(None) is None


def test_calendar_requires_published_at(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(
        json.dumps(
            [
                {
                    "event_id": "a",
                    "name": "CPI",
                    "scheduled_at": "2026-06-02T12:30:00+00:00",
                    "impact": "HIGH",
                }
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(DataQualityError):
        load_macro_events(p)


def test_calendar_loads_with_publication_timestamp(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(
        json.dumps(
            [
                {
                    "event_id": "a",
                    "name": "CPI",
                    "scheduled_at": "2026-06-02T12:30:00+00:00",
                    "impact": "HIGH",
                    "published_at": "2026-05-20T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    events = load_macro_events(p)
    assert events is not None and len(events) == 1
    assert events[0].timing.available_at < events[0].scheduled_at


# ---------------------------------------------------------------------------
# Broker adapters
# ---------------------------------------------------------------------------


def test_read_only_adapter_refuses_to_submit():
    adapter = ReadOnlyBrokerAdapter()
    with pytest.raises(ExecutionModeViolation):
        adapter.submit(plan=None, as_of=F.DECISION_AT, tag="x")  # type: ignore[arg-type]


def test_no_adapter_supports_live():
    assert ReadOnlyBrokerAdapter().supports_live is False
    assert ShadowBrokerAdapter().supports_live is False


def test_orchestrator_refuses_live_capable_adapter():
    from degold_os.orchestration.orchestrator import DecisionOrchestrator

    class FakeLiveAdapter:
        name = "fake"
        mode = ExecutionMode.LIVE
        supports_live = True

    with pytest.raises(ExecutionModeViolation):
        DecisionOrchestrator(broker=FakeLiveAdapter())


# ---------------------------------------------------------------------------
# Telemetria
# ---------------------------------------------------------------------------


def _record(decision: Decision, status: GateStatus) -> DecisionRecord:
    gate = (
        GateResult.pass_(GateId.G0_DATA)
        if status is GateStatus.PASS
        else GateResult.fail(GateId.G0_DATA, "motivo")
    )
    return DecisionRecord(
        decision_id="d1",
        as_of=datetime(2026, 6, 2, 13, 43, tzinfo=UTC),
        instrument="MNQ",
        execution_mode=ExecutionMode.SHADOW,
        session_phase=SessionPhase.NY_OPEN,
        decision=decision,
        gates=GateEvaluation((gate,), None if status is GateStatus.PASS else GateId.G0_DATA),
        trade_plan=None,
        eval_ms=1.5,
    )


def test_jsonl_sink_appends_one_line_per_event(tmp_path):
    sink = JsonlTelemetrySink(tmp_path / "t" / "decisions.jsonl")
    sink.emit_decision(_record(Decision.NO_TRADE, GateStatus.FAIL))
    sink.emit_decision(_record(Decision.OBSERVE, GateStatus.PASS))
    lines = (tmp_path / "t" / "decisions.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    payload = json.loads(lines[0])
    assert payload["event_type"] == "decision"
    assert payload["schema_version"]
    assert payload["payload"]["decision"] == "NO_TRADE"


def test_null_sink_is_default_and_silent():
    sink = build_sink("desconhecido")
    sink.emit("x", {})
    sink.emit_decision(_record(Decision.NO_TRADE, GateStatus.FAIL))
    sink.flush()


def test_metrics_count_blocking_gate():
    metrics = aggregate(
        [
            _record(Decision.NO_TRADE, GateStatus.FAIL),
            _record(Decision.NO_TRADE, GateStatus.FAIL),
            _record(Decision.OBSERVE, GateStatus.PASS),
        ]
    )
    assert metrics.total == 3
    assert metrics.by_decision["NO_TRADE"] == 2
    assert metrics.blocked_at["G0_DATA"] == 2
    assert metrics.latency_ms_avg == pytest.approx(1.5)
