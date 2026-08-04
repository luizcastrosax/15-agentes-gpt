"""Gates: semântica de status, política fail-closed e rebaixamento por proxy."""

from __future__ import annotations

import fixtures as F
import pytest

from degold_os.configuration.models import GatePolicy
from degold_os.domain.assessments import (
    AcceptanceAssessment,
    DataQualityReport,
    FlowAssessment,
    MacroAssessment,
    MaturityAssessment,
    PositionAssessment,
    StructureAssessment,
)
from degold_os.domain.decision import GateResult
from degold_os.domain.enums import (
    AcceptanceVerdict,
    Confidence,
    DataQualityStatus,
    EdgeMaturityStage,
    FlowVerdict,
    GateId,
    GateStatus,
    PositionState,
    Side,
    StructureEvent,
    Timeframe,
    TrendDirection,
)
from degold_os.domain.errors import ConfigurationError
from degold_os.domain.measurement import MissingMeasurement
from degold_os.orchestration import gates as G


@pytest.fixture(scope="module")
def ctx():
    return F.make_context(series=F.build_series())


# -- política ---------------------------------------------------------------


def test_not_available_is_translated_by_policy(ctx):
    result = GateResult.not_available(GateId.G1_MACRO, "sem calendário")
    policy = ctx.config.gates
    assert policy.treat_not_available_as is GateStatus.FAIL
    assert G.effective_status(result, policy) is GateStatus.FAIL


def test_policy_cannot_treat_not_available_as_pass():
    with pytest.raises(ConfigurationError):
        GatePolicy.from_dict(
            {"treat_not_available_as": "PASS", "max_conditional_gates": 3}
        )


def test_critical_gates_cannot_be_declared_non_critical():
    with pytest.raises(ConfigurationError):
        GatePolicy.from_dict(
            {
                "treat_not_available_as": "FAIL",
                "non_critical_gates": ["G7_RISK"],
                "max_conditional_gates": 3,
            }
        )


def test_pass_with_proxy_is_demoted_to_conditional():
    passing = GateResult.pass_(GateId.G5_FLOW, uses_proxy=True)
    demoted = G._demote_if_proxy(passing)
    assert demoted.status is GateStatus.CONDITIONAL
    assert demoted.uses_proxy


# -- G0 ---------------------------------------------------------------------


def test_g0_unusable_fails(ctx):
    report = DataQualityReport(
        status=DataQualityStatus.UNUSABLE,
        per_timeframe=(),
        feed_staleness_seconds=999.0,
        quote_available=False,
        notes=("feed obsoleto",),
    )
    assert G.gate_g0_data(ctx, report).status is GateStatus.FAIL


def test_g0_degraded_is_conditional(ctx):
    report = DataQualityReport(
        status=DataQualityStatus.DEGRADED,
        per_timeframe=(),
        feed_staleness_seconds=1.0,
        quote_available=False,
        notes=("buraco na grade",),
    )
    assert G.gate_g0_data(ctx, report).status is GateStatus.CONDITIONAL


# -- G1 ---------------------------------------------------------------------


def test_g1_missing_calendar_is_not_available_when_required(ctx):
    macro = MacroAssessment(
        calendar_available=False,
        in_blackout=False,
        blocking_event_name=None,
        seconds_to_next_high_impact=None,
        events_considered=0,
    )
    result = G.gate_g1_macro(ctx, macro)
    assert result.status is GateStatus.NOT_AVAILABLE
    assert G.effective_status(result, ctx.config.gates) is GateStatus.FAIL


def test_g1_missing_calendar_is_conditional_when_not_required():
    cfg = F.shadow_ready_config(
        macro={
            "require_calendar": False,
            "blackout_before_seconds": 900,
            "blackout_after_seconds": 900,
            "blocking_impacts": ["HIGH"],
        }
    )
    ctx = F.make_context(config=cfg, series=F.build_series())
    macro = MacroAssessment(False, False, None, None, 0)
    assert G.gate_g1_macro(ctx, macro).status is GateStatus.CONDITIONAL


def test_g1_blackout_fails(ctx):
    macro = MacroAssessment(True, True, "US CPI", 60.0, 1)
    assert G.gate_g1_macro(ctx, macro).status is GateStatus.FAIL


# -- G4 ---------------------------------------------------------------------


def _acceptance(verdict: AcceptanceVerdict, side=Side.SHORT) -> AcceptanceAssessment:
    return AcceptanceAssessment(
        verdict=verdict,
        time_beyond_ratio=MissingMeasurement(reason="teste", unit="ratio"),
        close_back_inside=True,
        rejection_wick_ratio=MissingMeasurement(reason="teste", unit="ratio"),
        reference_price=21000.0,
        side=side,
        confidence=Confidence.LOW,
        uses_proxy=True,
    )


def _structure(event: StructureEvent, direction: TrendDirection) -> StructureAssessment:
    return StructureAssessment(
        timeframe=Timeframe.M2, last_event=event, direction=direction
    )


def test_g4_acceptance_beyond_level_fails(ctx):
    from degold_os.domain.assessments import LiquidityAssessment

    result = G.gate_g4_interaction(
        ctx,
        _acceptance(AcceptanceVerdict.ACCEPTANCE),
        _structure(StructureEvent.BOS_DOWN, TrendDirection.DOWN),
        LiquidityAssessment(pools=(), active_sweep=None),
    )
    assert result.status is GateStatus.FAIL


def test_g4_structure_against_side_fails(ctx):
    from degold_os.domain.assessments import LiquidityAssessment

    result = G.gate_g4_interaction(
        ctx,
        _acceptance(AcceptanceVerdict.REJECTION),
        _structure(StructureEvent.BOS_UP, TrendDirection.UP),
        LiquidityAssessment(pools=(), active_sweep=None),
    )
    assert result.status is GateStatus.FAIL


def test_g4_rejection_without_structure_is_conditional(ctx):
    from degold_os.domain.assessments import LiquidityAssessment

    result = G.gate_g4_interaction(
        ctx,
        _acceptance(AcceptanceVerdict.REJECTION),
        _structure(StructureEvent.NONE, TrendDirection.SIDEWAYS),
        LiquidityAssessment(pools=(), active_sweep=None),
    )
    assert result.status is GateStatus.CONDITIONAL


# -- G5 ---------------------------------------------------------------------


def _flow(verdict: FlowVerdict, uses_proxy: bool = True) -> FlowAssessment:
    return FlowAssessment(
        verdict=verdict,
        delta=MissingMeasurement(reason="sem tick data", unit="contracts"),
        volume_ratio=None,
        aggression_ratio=None,
        uses_proxy=uses_proxy,
        notes=("teste",),
    )


def test_g5_supportive_proxy_never_passes(ctx):
    result = G.gate_g5_flow(ctx, _flow(FlowVerdict.SUPPORTIVE))
    assert result.status is GateStatus.CONDITIONAL
    assert result.uses_proxy


def test_g5_opposed_fails(ctx):
    assert G.gate_g5_flow(ctx, _flow(FlowVerdict.OPPOSED)).status is GateStatus.FAIL


def test_g5_not_available_when_no_flow_source(ctx):
    result = G.gate_g5_flow(ctx, _flow(FlowVerdict.NOT_AVAILABLE, uses_proxy=False))
    assert result.status is GateStatus.NOT_AVAILABLE


# -- G6 ---------------------------------------------------------------------


def test_g6_without_plan_fails(ctx):
    assert G.gate_g6_execution(ctx, None).status is GateStatus.FAIL


# -- G8 / G9 ----------------------------------------------------------------


def test_g8_unknown_state_is_not_available(ctx):
    p = PositionAssessment(
        state=PositionState.BLOCKED,
        open_quantity=0,
        open_side=None,
        allows_new_entry=False,
        state_known=False,
        notes=("desconhecido",),
    )
    result = G.gate_g8_position(ctx, p)
    assert result.status is GateStatus.NOT_AVAILABLE
    assert G.effective_status(result, ctx.config.gates) is GateStatus.FAIL


def test_g9_below_shadow_stage_fails(ctx):
    m = MaturityAssessment(
        setup_id="s",
        stage=EdgeMaturityStage.BACKTEST_IN_SAMPLE,
        oos_completed=False,
        walk_forward_completed=False,
        sample_size=None,
        historical_confidence=None,
    )
    assert G.gate_g9_edge_maturity(ctx, m).status is GateStatus.FAIL


def test_g9_requires_oos_and_walk_forward(ctx):
    m = MaturityAssessment(
        setup_id="s",
        stage=EdgeMaturityStage.SHADOW_MODE,
        oos_completed=True,
        walk_forward_completed=False,
        sample_size=50,
        historical_confidence=None,
    )
    result = G.gate_g9_edge_maturity(ctx, m)
    assert result.status is GateStatus.FAIL
    assert any("walk-forward" in r for r in result.reasons)


def test_g9_without_evidence_reference_is_conditional(ctx):
    m = MaturityAssessment(
        setup_id="s",
        stage=EdgeMaturityStage.SHADOW_MODE,
        oos_completed=True,
        walk_forward_completed=True,
        sample_size=120,
        historical_confidence=0.4,
        evidence_ref=None,
    )
    assert G.gate_g9_edge_maturity(ctx, m).status is GateStatus.CONDITIONAL


def test_historical_confidence_requires_oos_and_walk_forward():
    from degold_os.domain.errors import ContractViolation

    with pytest.raises(ContractViolation):
        MaturityAssessment(
            setup_id="s",
            stage=EdgeMaturityStage.BACKTEST_IN_SAMPLE,
            oos_completed=False,
            walk_forward_completed=False,
            sample_size=10,
            historical_confidence=0.9,
        )
