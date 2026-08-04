"""Testes unitários dos engines, com foco nos contratos de ausência e proxy."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import fixtures as F
import pytest

from degold_os.domain.account import AccountState, PositionSnapshot, SessionRiskLedger
from degold_os.domain.assessments import LiquidityAssessment
from degold_os.domain.enums import (
    AcceptanceVerdict,
    DataQualityStatus,
    FlowVerdict,
    MarketRegime,
    PositionState,
    RiskBreach,
    SessionPhase,
    Side,
    StructureEvent,
    SweepOutcome,
    Timeframe,
    TrendDirection,
)
from degold_os.domain.events import MacroEvent
from degold_os.domain.market import BarSeries
from degold_os.domain.timing import EventTiming
from degold_os.engines import (
    BaselineAcceptanceEngine,
    BaselineDataQualityEngine,
    BaselineExecutionEngine,
    BaselineFlowEngine,
    BaselineLiquidityEngine,
    BaselineMacroEngine,
    BaselinePositionStateRouter,
    BaselineRegimeEngine,
    BaselineRiskEngine,
    BaselineSessionEngine,
    BaselineStructureEngine,
)

UTC = timezone.utc


@pytest.fixture(scope="module")
def series():
    return F.build_series()


@pytest.fixture
def ctx(series):
    return F.make_context(series=series)


# ---------------------------------------------------------------------------
# Data Quality
# ---------------------------------------------------------------------------


def test_data_quality_ok_on_clean_fixture(ctx):
    report = BaselineDataQualityEngine().assess(ctx)
    assert report.status is DataQualityStatus.OK
    assert report.is_usable


def test_missing_timeframe_is_not_available_not_ok(series):
    partial = {tf: s for tf, s in series.items() if tf is not Timeframe.M5}
    ctx = F.make_context(series=partial)
    report = BaselineDataQualityEngine().assess(ctx)
    statuses = {h.timeframe: h.status for h in report.per_timeframe}
    assert statuses[Timeframe.M5] is DataQualityStatus.NOT_AVAILABLE
    assert report.status is DataQualityStatus.NOT_AVAILABLE


def test_stale_feed_makes_data_unusable(series):
    ctx = F.make_context(series=series)
    stale = replace(
        ctx.snapshot, feed_last_message_at=ctx.now - timedelta(seconds=600)
    )
    ctx = replace(ctx, snapshot=stale)
    report = BaselineDataQualityEngine().assess(ctx)
    assert report.status is DataQualityStatus.UNUSABLE
    assert any("obsoleto" in n for n in report.notes)


def test_feed_timestamp_in_the_future_is_unusable(series):
    ctx = F.make_context(series=series)
    ctx = replace(
        ctx,
        snapshot=replace(
            ctx.snapshot, feed_last_message_at=ctx.now + timedelta(seconds=10)
        ),
    )
    report = BaselineDataQualityEngine().assess(ctx)
    assert report.status is DataQualityStatus.UNUSABLE


def test_missing_heartbeat_is_degraded_not_ok(series):
    ctx = F.make_context(series=series)
    ctx = replace(ctx, snapshot=replace(ctx.snapshot, feed_last_message_at=None))
    report = BaselineDataQualityEngine().assess(ctx)
    assert report.status is DataQualityStatus.DEGRADED


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


def test_session_classifies_ny_open(ctx):
    state = BaselineSessionEngine().classify(ctx)
    assert state.phase is SessionPhase.NY_OPEN
    assert state.is_tradable_window


def test_session_weekend_is_market_closed(series):
    saturday = datetime(2026, 6, 6, 14, 0, tzinfo=UTC)
    ctx = F.make_context(series=series, as_of=saturday)
    state = BaselineSessionEngine().classify(ctx)
    assert state.phase is SessionPhase.MARKET_CLOSED
    assert not state.is_tradable_window


def test_session_midday_is_not_tradable(series):
    midday = datetime(2026, 6, 2, 16, 30, tzinfo=UTC)  # 12:30 ET
    ctx = F.make_context(series=series, as_of=midday)
    state = BaselineSessionEngine().classify(ctx)
    assert state.phase is SessionPhase.NY_MIDDAY
    assert not state.is_tradable_window


# ---------------------------------------------------------------------------
# Macro — ausência de dado ≠ ausência de evento
# ---------------------------------------------------------------------------


def test_macro_none_means_calendar_unavailable(series):
    ctx = F.make_context(series=series, macro_events=None)
    assessment = BaselineMacroEngine().assess(ctx)
    assert assessment.calendar_available is False
    assert assessment.in_blackout is False
    assert any("ausência de dado" in n for n in assessment.notes)


def test_macro_empty_list_means_no_events(series):
    ctx = F.make_context(series=series, macro_events=())
    assessment = BaselineMacroEngine().assess(ctx)
    assert assessment.calendar_available is True
    assert assessment.in_blackout is False


def test_macro_blackout_around_high_impact_event(series):
    at = F.DECISION_AT
    event = MacroEvent(
        event_id="evt1",
        name="US CPI",
        scheduled_at=at + timedelta(minutes=5),
        impact="HIGH",
        timing=EventTiming.confirmed_now(at - timedelta(days=7), at - timedelta(days=7)),
        source="fixture",
    )
    ctx = F.make_context(series=series, macro_events=(event,))
    assessment = BaselineMacroEngine().assess(ctx)
    assert assessment.in_blackout
    assert assessment.blocking_event_name == "US CPI"


def test_macro_low_impact_event_does_not_block(series):
    at = F.DECISION_AT
    event = MacroEvent(
        event_id="evt2",
        name="Fed speaker",
        scheduled_at=at + timedelta(minutes=5),
        impact="LOW",
        timing=EventTiming.confirmed_now(at - timedelta(days=7), at - timedelta(days=7)),
    )
    ctx = F.make_context(series=series, macro_events=(event,))
    assert BaselineMacroEngine().assess(ctx).in_blackout is False


# ---------------------------------------------------------------------------
# Regime
# ---------------------------------------------------------------------------


def test_regime_is_classified_on_fixture(ctx):
    r = BaselineRegimeEngine().assess(ctx)
    assert r.regime is not MarketRegime.UNKNOWN
    assert r.htf_direction is TrendDirection.UP
    assert r.basis == (Timeframe.H4, Timeframe.M15)


def test_regime_unknown_when_htf_absent(series):
    partial = {tf: s for tf, s in series.items() if tf is not Timeframe.H4}
    partial[Timeframe.H4] = BarSeries(Timeframe.H4)
    ctx = F.make_context(series=partial)
    r = BaselineRegimeEngine().assess(ctx)
    assert r.regime is MarketRegime.UNKNOWN
    # Ausência vira MissingMeasurement, nunca 0.0.
    assert r.atr is not None and r.atr.to_dict()["value"] is None


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------


def test_structure_detects_downside_break_after_sweep(ctx):
    s = BaselineStructureEngine().assess(ctx)
    assert s.last_event in (StructureEvent.CHOCH_DOWN, StructureEvent.BOS_DOWN)
    assert s.direction is TrendDirection.DOWN


def test_structure_signals_are_all_confirmed_and_visible(ctx):
    s = BaselineStructureEngine().assess(ctx)
    assert s.signals
    for sig in s.signals:
        assert sig.timing.is_confirmed
        assert sig.timing.confirmed_visible_at(ctx.now)


# ---------------------------------------------------------------------------
# Liquidity
# ---------------------------------------------------------------------------


def test_liquidity_pools_are_labelled_as_proxy(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    assert liq.pools
    assert liq.uses_proxy
    for pool in liq.pools:
        assert pool.source.value == "PROXY"
        assert pool.proxy_for == "resting_stop_liquidity"


def test_active_sweep_is_confirmed_rejection(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    sweep = liq.active_sweep
    assert sweep is not None
    assert sweep.outcome is SweepOutcome.REJECTED
    assert sweep.timing.is_confirmed
    assert sweep.side is Side.SHORT
    assert sweep.penetration_price == pytest.approx(F.SWEEP_HIGH)


def test_pending_sweep_is_never_confirmed(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    for sweep in liq.pending_sweeps:
        assert sweep.outcome is SweepOutcome.PENDING
        assert not sweep.timing.is_confirmed


# ---------------------------------------------------------------------------
# Acceptance
# ---------------------------------------------------------------------------


def test_acceptance_reports_rejection(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    acc = BaselineAcceptanceEngine().assess(ctx, liq)
    assert acc.verdict is AcceptanceVerdict.REJECTION
    assert acc.close_back_inside is True
    assert acc.side is Side.SHORT
    assert acc.uses_proxy


def test_acceptance_not_available_without_sweep(ctx):
    empty = LiquidityAssessment(pools=(), active_sweep=None)
    acc = BaselineAcceptanceEngine().assess(ctx, empty)
    assert acc.verdict is AcceptanceVerdict.NOT_AVAILABLE
    assert acc.reference_price is None


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------


def test_flow_never_fabricates_delta(ctx):
    flow = BaselineFlowEngine().assess(ctx, Side.SHORT)
    assert flow.delta is not None
    assert flow.delta.to_dict()["value"] is None
    assert flow.uses_proxy


def test_flow_disabled_proxy_returns_not_available(series):
    cfg = F.shadow_ready_config(
        flow={"timeframe": "M1", "lookback_bars": 20, "min_volume_ratio": 1.2,
              "allow_proxy": False}
    )
    ctx = F.make_context(config=cfg, series=series)
    flow = BaselineFlowEngine().assess(ctx, Side.SHORT)
    assert flow.verdict is FlowVerdict.NOT_AVAILABLE
    assert flow.uses_proxy is False


def test_flow_opposed_when_bar_moves_against_side(ctx):
    flow = BaselineFlowEngine().assess(ctx, Side.LONG)
    assert flow.verdict is FlowVerdict.OPPOSED


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


def test_execution_plan_geometry(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    acc = BaselineAcceptanceEngine().assess(ctx, liq)
    plan = BaselineExecutionEngine().build_plan(ctx, Side.SHORT, liq, acc, 1)
    assert plan is not None
    assert plan.target_price < plan.entry_price < plan.stop_price
    assert plan.rr == pytest.approx(ctx.config.execution.target_r_multiple)
    assert plan.rr_net is not None and plan.rr_net < plan.rr, "custo deve reduzir o R:R"


def test_execution_cost_is_proxy_without_quote(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    acc = BaselineAcceptanceEngine().assess(ctx, liq)
    plan = BaselineExecutionEngine().build_plan(ctx, Side.SHORT, liq, acc, 1)
    assert plan is not None and plan.cost_points is not None
    assert plan.cost_points.is_proxy


def test_execution_cost_is_measured_with_quote(series):
    ctx = F.make_context(series=series, with_quote=True)
    liq = BaselineLiquidityEngine().assess(ctx)
    acc = BaselineAcceptanceEngine().assess(ctx, liq)
    plan = BaselineExecutionEngine().build_plan(ctx, Side.SHORT, liq, acc, 1)
    assert plan is not None and plan.cost_points is not None
    assert not plan.cost_points.is_proxy


def test_position_sizing_respects_budget_and_cap(ctx):
    eng = BaselineExecutionEngine()
    # 8.5 pts * $2 = $17 por contrato.
    assert eng.max_quantity_for_risk(ctx, 16.0, 8.5) == 0
    assert eng.max_quantity_for_risk(ctx, 17.0, 8.5) == 1
    assert eng.max_quantity_for_risk(ctx, 10_000.0, 8.5) == ctx.config.risk.max_contracts


# ---------------------------------------------------------------------------
# Risk
# ---------------------------------------------------------------------------


def _plan(ctx):
    liq = BaselineLiquidityEngine().assess(ctx)
    acc = BaselineAcceptanceEngine().assess(ctx, liq)
    return BaselineExecutionEngine().build_plan(ctx, Side.SHORT, liq, acc, 1)


def test_risk_approves_healthy_state(ctx):
    risk = BaselineRiskEngine().assess(ctx, _plan(ctx))
    assert risk.approved
    assert risk.breaches == ()


def test_unknown_account_blocks_and_is_not_zero_equity(series):
    ctx = F.make_context(series=series, account=None)
    risk = BaselineRiskEngine().assess(ctx, None)
    assert not risk.approved
    assert RiskBreach.RISK_STATE_UNKNOWN in risk.breaches
    assert risk.account_state_known is False
    assert BaselineRiskEngine().risk_budget(ctx) is None


def test_unknown_ledger_blocks(series):
    ledger = SessionRiskLedger(session_date="2026-06-02")  # tudo None
    ctx = F.make_context(series=series, ledger=ledger)
    risk = BaselineRiskEngine().assess(ctx, None)
    assert RiskBreach.RISK_STATE_UNKNOWN in risk.breaches


def test_stale_account_blocks(series):
    old = AccountState(
        equity=50_000.0,
        currency="USD",
        as_of=F.DECISION_AT - timedelta(minutes=10),
    )
    ctx = F.make_context(series=series, account=old)
    risk = BaselineRiskEngine().assess(ctx, None)
    assert RiskBreach.ACCOUNT_STATE_STALE in risk.breaches


def test_daily_loss_limit_blocks(series):
    ledger = SessionRiskLedger(
        session_date="2026-06-02",
        realized_pnl=-400.0,  # limite = 0.75% de 50k = 375
        trades_taken=1,
        consecutive_losses=1,
    )
    ctx = F.make_context(series=series, ledger=ledger)
    risk = BaselineRiskEngine().assess(ctx, _plan(ctx))
    assert RiskBreach.DAILY_LOSS_LIMIT in risk.breaches
    assert not risk.approved


def test_max_trades_blocks(series):
    ledger = SessionRiskLedger(
        session_date="2026-06-02", realized_pnl=0.0, trades_taken=3, consecutive_losses=0
    )
    ctx = F.make_context(series=series, ledger=ledger)
    risk = BaselineRiskEngine().assess(ctx, _plan(ctx))
    assert RiskBreach.MAX_TRADES_PER_SESSION in risk.breaches


# ---------------------------------------------------------------------------
# Position router
# ---------------------------------------------------------------------------


def test_unknown_position_blocks_entry(series):
    ctx = F.make_context(series=series, position=None)
    p = BaselinePositionStateRouter().assess(ctx)
    assert p.state is PositionState.BLOCKED
    assert p.allows_new_entry is False
    assert p.state_known is False


def test_stale_position_blocks_entry(series):
    snap = PositionSnapshot(
        state=PositionState.FLAT, as_of=F.DECISION_AT - timedelta(minutes=5)
    )
    ctx = F.make_context(series=series, position=snap)
    p = BaselinePositionStateRouter().assess(ctx)
    assert p.allows_new_entry is False
    assert p.state_known is False


def test_pending_orders_block_entry(series):
    snap = PositionSnapshot(
        state=PositionState.FLAT, as_of=F.DECISION_AT, pending_order_ids=("o1",)
    )
    ctx = F.make_context(series=series, position=snap)
    assert BaselinePositionStateRouter().assess(ctx).allows_new_entry is False


def test_flat_allows_entry(series):
    ctx = F.make_context(series=series)
    p = BaselinePositionStateRouter().assess(ctx)
    assert p.allows_new_entry is True
    assert p.state is PositionState.FLAT
