"""Máquinas de estado: transições legais, ilegais e a escada de maturidade."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from degold_os.domain.enums import EdgeMaturityStage, PositionState
from degold_os.domain.errors import ContractViolation, MaturityViolation
from degold_os.orchestration.state_machines import (
    MaturityLadder,
    PositionLifecycle,
    SetupLifecycle,
    SetupPhase,
    SweepLifecycle,
    SweepPhase,
)

UTC = timezone.utc
T0 = datetime(2026, 6, 2, 13, 0, tzinfo=UTC)


def test_sweep_confirmed_cannot_return_to_detected():
    m = SweepLifecycle()
    m.to(SweepPhase.DETECTED, T0, "penetração")
    m.to(SweepPhase.CONFIRMED_REJECTED, T0 + timedelta(minutes=5), "fechou de volta")
    with pytest.raises(ContractViolation):
        m.to(SweepPhase.DETECTED, T0 + timedelta(minutes=6), "repaint")


def test_sweep_confirmed_cannot_flip_outcome():
    m = SweepLifecycle()
    m.to(SweepPhase.DETECTED, T0, "penetração")
    m.to(SweepPhase.CONFIRMED_REJECTED, T0 + timedelta(minutes=5), "rejeitado")
    with pytest.raises(ContractViolation):
        m.to(SweepPhase.CONFIRMED_ACCEPTED, T0 + timedelta(minutes=6), "mudou de ideia")


def test_transitions_cannot_go_back_in_time():
    m = SweepLifecycle()
    m.to(SweepPhase.DETECTED, T0 + timedelta(minutes=5), "penetração")
    with pytest.raises(ContractViolation):
        m.to(SweepPhase.CONFIRMED_REJECTED, T0, "retroativo")


def test_transition_history_is_recorded():
    m = SetupLifecycle()
    m.to(SetupPhase.ARMED, T0, "sweep confirmado")
    m.to(SetupPhase.TRIGGERED, T0 + timedelta(minutes=1), "entrada acionada")
    assert [h.to_state for h in m.history] == ["ARMED", "TRIGGERED"]
    assert m.history[0].reason == "sweep confirmado"


def test_setup_invalidated_is_terminal():
    m = SetupLifecycle()
    m.to(SetupPhase.ARMED, T0, "armado")
    m.to(SetupPhase.INVALIDATED, T0 + timedelta(minutes=1), "aceitação além do nível")
    with pytest.raises(ContractViolation):
        m.to(SetupPhase.TRIGGERED, T0 + timedelta(minutes=2), "ressuscitar")


def test_position_flat_to_open_requires_pending():
    m = PositionLifecycle()
    with pytest.raises(ContractViolation):
        m.to(PositionState.OPEN, T0, "pulou o estado pendente")
    m.to(PositionState.PENDING_ENTRY, T0, "ordem enviada")
    m.to(PositionState.OPEN, T0 + timedelta(seconds=5), "preenchida")


def test_blocked_position_only_returns_to_flat():
    m = PositionLifecycle()
    m.to(PositionState.BLOCKED, T0, "estado desconhecido")
    with pytest.raises(ContractViolation):
        m.to(PositionState.PENDING_ENTRY, T0 + timedelta(minutes=1), "tentativa")
    m.to(PositionState.FLAT, T0 + timedelta(minutes=2), "reconciliado com o broker")


# -- escada de maturidade ---------------------------------------------------


def _ladder_to(stage: EdgeMaturityStage) -> MaturityLadder:
    ladder = MaturityLadder()
    order = [
        EdgeMaturityStage.BACKTEST_IN_SAMPLE,
        EdgeMaturityStage.BACKTEST_OUT_OF_SAMPLE,
        EdgeMaturityStage.WALK_FORWARD_VALIDATED,
        EdgeMaturityStage.SHADOW_MODE,
    ]
    t = T0
    for target in order:
        ladder.promote(
            target,
            t,
            approved_by="humano@degold",
            evidence_ref="artifacts/reports/x.md",
            oos_completed=True,
            walk_forward_completed=True,
        )
        t += timedelta(days=1)
        if target is stage:
            break
    return ladder


def test_promotion_requires_human_approval():
    ladder = MaturityLadder()
    with pytest.raises(MaturityViolation):
        ladder.promote(
            EdgeMaturityStage.BACKTEST_IN_SAMPLE,
            T0,
            approved_by="   ",
            evidence_ref="x",
            oos_completed=True,
            walk_forward_completed=True,
        )


def test_promotion_requires_evidence_reference():
    ladder = MaturityLadder()
    with pytest.raises(MaturityViolation):
        ladder.promote(
            EdgeMaturityStage.BACKTEST_IN_SAMPLE,
            T0,
            approved_by="humano",
            evidence_ref="",
            oos_completed=True,
            walk_forward_completed=True,
        )


def test_promotion_is_one_step_at_a_time():
    ladder = MaturityLadder()
    with pytest.raises(MaturityViolation):
        ladder.promote(
            EdgeMaturityStage.SHADOW_MODE,
            T0,
            approved_by="humano",
            evidence_ref="x",
            oos_completed=True,
            walk_forward_completed=True,
        )


def test_shadow_mode_requires_oos_and_walk_forward():
    ladder = _ladder_to(EdgeMaturityStage.WALK_FORWARD_VALIDATED)
    with pytest.raises(MaturityViolation):
        ladder.promote(
            EdgeMaturityStage.SHADOW_MODE,
            T0 + timedelta(days=10),
            approved_by="humano",
            evidence_ref="x",
            oos_completed=True,
            walk_forward_completed=False,
        )


def test_promotion_above_shadow_is_refused_in_this_version():
    ladder = _ladder_to(EdgeMaturityStage.SHADOW_MODE)
    assert ladder.stage is EdgeMaturityStage.SHADOW_MODE
    with pytest.raises(MaturityViolation):
        ladder.promote(
            EdgeMaturityStage.LIVE_PILOT,
            T0 + timedelta(days=30),
            approved_by="humano",
            evidence_ref="x",
            oos_completed=True,
            walk_forward_completed=True,
        )


def test_demotion_needs_no_approval():
    ladder = _ladder_to(EdgeMaturityStage.SHADOW_MODE)
    ladder.demote(
        EdgeMaturityStage.RESEARCH, T0 + timedelta(days=40), "degradação observada"
    )
    assert ladder.stage is EdgeMaturityStage.RESEARCH


def test_demote_refuses_to_promote():
    ladder = MaturityLadder()
    with pytest.raises(MaturityViolation):
        ladder.demote(EdgeMaturityStage.SHADOW_MODE, T0, "tentativa disfarçada")
