"""Integração: o pipeline completo, do snapshot ao DecisionRecord."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import fixtures as F
import pytest

from degold_os.adapters.broker_shadow import ShadowBrokerAdapter
from degold_os.domain.account import PositionSnapshot, SessionRiskLedger
from degold_os.domain.enums import (
    Decision,
    ExecutionMode,
    GATE_ORDER,
    GateId,
    GateStatus,
    PositionState,
    Side,
    Timeframe,
)
from degold_os.domain.errors import ExecutionModeViolation
from degold_os.domain.events import MacroEvent
from degold_os.domain.market import BarSeries
from degold_os.domain.timing import EventTiming
from degold_os.orchestration.orchestrator import DecisionOrchestrator, EngineBundle
from degold_os.telemetry.sinks import JsonlTelemetrySink

UTC = timezone.utc


@pytest.fixture(scope="module")
def series():
    return F.build_series()


def _shift(bar, delta: timedelta):
    """Desloca uma barra no tempo preservando os carimbos causais relativos."""
    return F.make_bar(
        bar.timeframe,
        bar.open_time + delta,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
    )


# ---------------------------------------------------------------------------
# Caminho feliz
# ---------------------------------------------------------------------------


def test_full_pipeline_reaches_shadow_intent(series):
    record = DecisionOrchestrator().evaluate(F.make_context(series=series))
    assert record.decision is Decision.SHADOW_INTENT
    assert record.trade_plan is not None
    assert record.trade_plan["side"] == str(Side.SHORT)
    assert record.gates.short_circuited_at is None
    assert {r.gate for r in record.gates.results} == set(GATE_ORDER)


def test_gates_are_evaluated_in_canonical_order(series):
    record = DecisionOrchestrator().evaluate(F.make_context(series=series))
    evaluated = [r.gate for r in record.gates.results]
    assert evaluated == list(GATE_ORDER)


def test_decision_record_is_versioned_and_reproducible(series):
    ctx = F.make_context(series=series)
    a = DecisionOrchestrator().evaluate(ctx)
    b = DecisionOrchestrator().evaluate(ctx)
    assert a.code_version and a.ruleset_version and a.config_hash and a.inputs_digest
    assert a.decision_id == b.decision_id
    assert F.comparable(a) == F.comparable(b)


def test_decision_is_explainable(series):
    record = DecisionOrchestrator().evaluate(F.make_context(series=series))
    text = record.explain()
    for gate in GATE_ORDER:
        assert str(gate) in text


def test_proxy_gates_are_flagged_and_never_pass(series):
    record = DecisionOrchestrator().evaluate(F.make_context(series=series))
    proxy_gates = {
        GateId.G3_LIQUIDITY,
        GateId.G4_INTERACTION,
        GateId.G5_FLOW,
        GateId.G6_EXECUTION,
    }
    for result in record.gates.results:
        if result.gate in proxy_gates:
            assert result.uses_proxy, f"{result.gate} deveria estar marcado como proxy"
            assert result.status is not GateStatus.PASS


def test_shadow_broker_records_intent_without_sending_orders(series):
    broker = ShadowBrokerAdapter()
    record = DecisionOrchestrator(broker=broker).evaluate(F.make_context(series=series))
    assert record.decision is Decision.SHADOW_INTENT
    assert len(broker.intents) == 1
    assert broker.intents[0].plan["side"] == str(Side.SHORT)
    assert broker.health()["supports_live"] is False


def test_telemetry_receives_the_decision(series, tmp_path):
    path = tmp_path / "decisions.jsonl"
    cfg = F.shadow_ready_config(
        telemetry={
            "enabled": True,
            "sink": "jsonl",
            "path": str(path),
            "log_all_decisions": True,
        }
    )
    sink = JsonlTelemetrySink(path)
    DecisionOrchestrator(telemetry=sink).evaluate(F.make_context(config=cfg, series=series))
    assert path.exists()
    assert len(path.read_text(encoding="utf-8").splitlines()) == 1


# ---------------------------------------------------------------------------
# Modos de execução
# ---------------------------------------------------------------------------


def test_read_only_mode_never_emits_intent(series):
    cfg = F.shadow_ready_config(
        runtime={
            "execution_mode": "READ_ONLY",
            "code_version": "0.1.0",
            "ruleset_version": "2026.08.0",
            "ingestion_latency_ms": F.LATENCY_MS,
        }
    )
    record = DecisionOrchestrator().evaluate(F.make_context(config=cfg, series=series))
    assert record.decision is Decision.OBSERVE
    assert record.trade_plan is None
    assert any("READ_ONLY" in w for w in record.warnings)


def test_live_mode_is_refused(series):
    cfg = F.shadow_ready_config(
        runtime={
            "execution_mode": "LIVE",
            "code_version": "0.1.0",
            "ruleset_version": "2026.08.0",
            "ingestion_latency_ms": F.LATENCY_MS,
        }
    )
    with pytest.raises(ExecutionModeViolation):
        DecisionOrchestrator().evaluate(F.make_context(config=cfg, series=series))


def test_research_stage_blocks_at_g9(series):
    record = DecisionOrchestrator().evaluate(
        F.make_context(config=F.test_config(), series=series)
    )
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G9_EDGE_MATURITY


# ---------------------------------------------------------------------------
# Fail-closed
# ---------------------------------------------------------------------------


def test_missing_timeframe_blocks_at_g0(series):
    partial = {tf: s for tf, s in series.items() if tf is not Timeframe.M2}
    record = DecisionOrchestrator().evaluate(F.make_context(series=partial))
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G0_DATA


def test_stale_feed_blocks_at_g0(series):
    ctx = F.make_context(series=series)
    ctx = replace(
        ctx,
        snapshot=replace(
            ctx.snapshot, feed_last_message_at=ctx.now - timedelta(minutes=30)
        ),
    )
    record = DecisionOrchestrator().evaluate(ctx)
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G0_DATA


def test_missing_calendar_blocks_at_g1(series):
    record = DecisionOrchestrator().evaluate(
        F.make_context(series=series, macro_events=None)
    )
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G1_MACRO


def test_macro_blackout_blocks_at_g1(series):
    published = F.DECISION_AT - timedelta(days=5)
    event = MacroEvent(
        event_id="cpi",
        name="US CPI",
        scheduled_at=F.DECISION_AT + timedelta(minutes=10),
        impact="HIGH",
        timing=EventTiming.confirmed_now(published, published),
    )
    record = DecisionOrchestrator().evaluate(
        F.make_context(series=series, macro_events=(event,))
    )
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G1_MACRO


def test_non_tradable_window_blocks_at_g2(series):
    """Fora da janela operável, G2 barra — com dados perfeitamente saudáveis.

    O instante escolhido (12:30 UTC = 08:30 ET) tem dados frescos; o que muda
    é apenas a configuração da janela. Assim o teste isola o gate de sessão em
    vez de esbarrar antes em G0 por obsolescência.
    """
    windows = [dict(w) for w in F.shadow_ready_config().raw["session"]["windows"]]
    for w in windows:
        w["tradable"] = False
    cfg = F.shadow_ready_config(
        session={
            "timezone": "America/New_York",
            "trading_weekdays": [0, 1, 2, 3, 4],
            "windows": windows,
        }
    )
    at = datetime(2026, 6, 2, 12, 30, tzinfo=UTC)
    record = DecisionOrchestrator().evaluate(
        F.make_context(config=cfg, series=series, as_of=at)
    )
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G2_REGIME
    reasons = record.gates.by_id(GateId.G2_REGIME).reasons
    assert any("janela" in r for r in reasons)


def test_market_closed_blocks_at_g2(series):
    """Sábado: fase MARKET_CLOSED barra em G2 (dados sintéticos frescos)."""
    saturday = datetime(2026, 6, 6, 13, 43, tzinfo=UTC)
    shifted = {
        tf: BarSeries(tf, [_shift(b, timedelta(days=4)) for b in s])
        for tf, s in series.items()
    }
    record = DecisionOrchestrator().evaluate(
        F.make_context(series=shifted, as_of=saturday)
    )
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G2_REGIME


def test_no_sweep_blocks_at_g3(series):
    """Sem barras suficientes após o sweep o gate de liquidez barra."""
    early = F.DECISION_AT - timedelta(hours=2)
    record = DecisionOrchestrator().evaluate(F.make_context(series=series, as_of=early))
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at in (GateId.G2_REGIME, GateId.G3_LIQUIDITY)


def test_unknown_risk_state_blocks_at_g7(series):
    ledger = SessionRiskLedger(session_date="2026-06-02")  # tudo desconhecido
    record = DecisionOrchestrator().evaluate(F.make_context(series=series, ledger=ledger))
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at in (GateId.G6_EXECUTION, GateId.G7_RISK)


def test_daily_loss_limit_blocks_at_g7(series):
    ledger = SessionRiskLedger(
        session_date="2026-06-02",
        realized_pnl=-500.0,
        trades_taken=2,
        consecutive_losses=1,
    )
    record = DecisionOrchestrator().evaluate(F.make_context(series=series, ledger=ledger))
    assert record.decision is Decision.NO_TRADE


def test_open_position_blocks_at_g8(series):
    from degold_os.domain.account import OpenPosition

    snap = PositionSnapshot(
        state=PositionState.OPEN,
        as_of=F.DECISION_AT,
        position=OpenPosition(
            side=Side.LONG, quantity=1, average_price=20990.0, opened_at=F.DECISION_AT
        ),
    )
    record = DecisionOrchestrator().evaluate(F.make_context(series=series, position=snap))
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G8_POSITION


def test_unknown_position_blocks_at_g8(series):
    record = DecisionOrchestrator().evaluate(F.make_context(series=series, position=None))
    assert record.decision is Decision.NO_TRADE
    assert record.gates.short_circuited_at is GateId.G8_POSITION


def test_engine_exception_becomes_no_trade(series):
    class ExplodingEngine:
        def assess(self, ctx):
            raise RuntimeError("falha interna simulada")

    bundle = replace(EngineBundle.baseline(), regime=ExplodingEngine())
    record = DecisionOrchestrator(engines=bundle).evaluate(F.make_context(series=series))
    assert record.decision is Decision.NO_TRADE
    assert any("falha interna simulada" in w for w in record.warnings)
    assert record.trade_plan is None


def test_empty_series_becomes_no_trade():
    empty = {tf: BarSeries(tf) for tf in Timeframe}
    record = DecisionOrchestrator().evaluate(F.make_context(series=empty))
    assert record.decision is Decision.NO_TRADE


def test_too_many_conditional_gates_blocks(series):
    cfg = F.shadow_ready_config(
        gates={
            "treat_not_available_as": "FAIL",
            "non_critical_gates": [],
            "max_conditional_gates": 1,
        }
    )
    record = DecisionOrchestrator().evaluate(F.make_context(config=cfg, series=series))
    assert record.decision is Decision.NO_TRADE
    assert any("CONDITIONAL" in w for w in record.warnings)


def test_no_trade_never_carries_a_plan(series):
    for ctx in (
        F.make_context(series=series, macro_events=None),
        F.make_context(series=series, position=None),
        F.make_context(config=F.test_config(), series=series),
    ):
        record = DecisionOrchestrator().evaluate(ctx)
        assert record.decision is Decision.NO_TRADE
        assert record.trade_plan is None


def test_no_decision_is_ever_a_live_order(series):
    contexts = [
        F.make_context(series=series),
        F.make_context(series=series, macro_events=None),
        F.make_context(config=F.test_config(), series=series),
    ]
    for ctx in contexts:
        record = DecisionOrchestrator().evaluate(ctx)
        assert record.decision is not Decision.LIVE_ORDER
        assert record.execution_mode is not ExecutionMode.LIVE
