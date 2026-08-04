"""Máquinas de estado explícitas.

Estado implícito espalhado por ``if`` é a origem de metade dos bugs de sistemas
de trading. Aqui cada ciclo de vida é uma tabela de transições declarada, com
transições ilegais recusadas em runtime.

Máquinas:

1. ``SweepLifecycle``     — detecção → confirmação → expiração de um sweep.
2. ``SetupLifecycle``     — armar, disparar e invalidar um setup.
3. ``PositionLifecycle``  — flat → pendente → aberta → saída → flat.
4. ``MaturityLadder``     — promoção/rebaixamento de maturidade, com aprovação
   humana obrigatória para promover.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Generic, Mapping, TypeVar

from ..domain.enums import EdgeMaturityStage, PositionState, maturity_rank
from ..domain.errors import ContractViolation, MaturityViolation
from ..domain.timing import ensure_utc

__all__ = [
    "SweepPhase",
    "SetupPhase",
    "TransitionLog",
    "StateMachine",
    "SweepLifecycle",
    "SetupLifecycle",
    "PositionLifecycle",
    "MaturityLadder",
]

S = TypeVar("S", bound=Enum)


class SweepPhase(str, Enum):
    IDLE = "IDLE"
    DETECTED = "DETECTED"
    CONFIRMED_REJECTED = "CONFIRMED_REJECTED"
    CONFIRMED_ACCEPTED = "CONFIRMED_ACCEPTED"
    EXPIRED = "EXPIRED"


class SetupPhase(str, Enum):
    IDLE = "IDLE"
    ARMED = "ARMED"
    TRIGGERED = "TRIGGERED"
    INVALIDATED = "INVALIDATED"
    EXPIRED = "EXPIRED"


@dataclass(frozen=True, slots=True)
class TransitionLog:
    """Uma transição registrada — o histórico é append-only e auditável."""

    from_state: str
    to_state: str
    at: datetime
    reason: str
    meta: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_state,
            "to": self.to_state,
            "at": self.at.isoformat(),
            "reason": self.reason,
            "meta": dict(self.meta),
        }


class StateMachine(Generic[S]):
    """Máquina de estados com tabela de transições e histórico imutável."""

    __slots__ = ("_state", "_table", "_history", "_name")

    def __init__(self, name: str, initial: S, table: Mapping[S, tuple[S, ...]]) -> None:
        self._name = name
        self._state = initial
        self._table = dict(table)
        self._history: list[TransitionLog] = []

    @property
    def state(self) -> S:
        return self._state

    @property
    def history(self) -> tuple[TransitionLog, ...]:
        return tuple(self._history)

    def can(self, to: S) -> bool:
        return to in self._table.get(self._state, ())

    def to(self, target: S, at: datetime, reason: str, **meta: Any) -> S:
        if not self.can(target):
            raise ContractViolation(
                f"{self._name}: transição ilegal {self._state.value} -> {target.value}"
            )
        at = ensure_utc(at)
        if self._history and at < self._history[-1].at:
            raise ContractViolation(
                f"{self._name}: transição com timestamp retroativo "
                f"({at.isoformat()} < {self._history[-1].at.isoformat()})"
            )
        self._history.append(
            TransitionLog(self._state.value, target.value, at, reason, meta)
        )
        self._state = target
        return self._state

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self._name,
            "state": self._state.value,
            "history": [h.to_dict() for h in self._history],
        }


def SweepLifecycle() -> StateMachine[SweepPhase]:
    return StateMachine(
        "sweep",
        SweepPhase.IDLE,
        {
            SweepPhase.IDLE: (SweepPhase.DETECTED,),
            SweepPhase.DETECTED: (
                SweepPhase.CONFIRMED_REJECTED,
                SweepPhase.CONFIRMED_ACCEPTED,
                SweepPhase.EXPIRED,
            ),
            # Um sweep confirmado só pode expirar. Nunca volta a ser pendente,
            # nunca troca de desfecho: histórico confirmado não se reescreve.
            SweepPhase.CONFIRMED_REJECTED: (SweepPhase.EXPIRED,),
            SweepPhase.CONFIRMED_ACCEPTED: (SweepPhase.EXPIRED,),
            SweepPhase.EXPIRED: (),
        },
    )


def SetupLifecycle() -> StateMachine[SetupPhase]:
    return StateMachine(
        "setup",
        SetupPhase.IDLE,
        {
            SetupPhase.IDLE: (SetupPhase.ARMED,),
            SetupPhase.ARMED: (
                SetupPhase.TRIGGERED,
                SetupPhase.INVALIDATED,
                SetupPhase.EXPIRED,
            ),
            SetupPhase.TRIGGERED: (SetupPhase.INVALIDATED, SetupPhase.EXPIRED),
            SetupPhase.INVALIDATED: (),
            SetupPhase.EXPIRED: (),
        },
    )


def PositionLifecycle() -> StateMachine[PositionState]:
    return StateMachine(
        "position",
        PositionState.FLAT,
        {
            PositionState.FLAT: (PositionState.PENDING_ENTRY, PositionState.BLOCKED),
            PositionState.PENDING_ENTRY: (
                PositionState.OPEN,
                PositionState.FLAT,
                PositionState.BLOCKED,
            ),
            PositionState.OPEN: (
                PositionState.SCALING_OUT,
                PositionState.PENDING_EXIT,
                PositionState.BLOCKED,
            ),
            PositionState.SCALING_OUT: (
                PositionState.PENDING_EXIT,
                PositionState.OPEN,
                PositionState.BLOCKED,
            ),
            PositionState.PENDING_EXIT: (PositionState.FLAT, PositionState.BLOCKED),
            # BLOCKED é absorvente até intervenção humana explícita: a saída é
            # sempre para FLAT, e só depois de reconciliação com o broker.
            PositionState.BLOCKED: (PositionState.FLAT,),
        },
    )


class MaturityLadder:
    """Escada de maturidade com promoção sob aprovação humana.

    Requisitos codificados:

    - Promover exige ``approved_by`` não vazio. IA adaptativa **não** promove.
    - Só se promove um degrau por vez.
    - Rebaixar é sempre permitido e não exige aprovação (segurança > processo).
    - ``SHADOW_MODE`` exige OOS **e** walk-forward concluídos.
    - Promoção acima de ``SHADOW_MODE`` é recusada nesta versão: não há
      caminho de execução real implementado.
    """

    __slots__ = ("_stage", "_history")

    def __init__(self, stage: EdgeMaturityStage = EdgeMaturityStage.RESEARCH) -> None:
        self._stage = stage
        self._history: list[TransitionLog] = []

    @property
    def stage(self) -> EdgeMaturityStage:
        return self._stage

    @property
    def history(self) -> tuple[TransitionLog, ...]:
        return tuple(self._history)

    def promote(
        self,
        target: EdgeMaturityStage,
        at: datetime,
        approved_by: str,
        evidence_ref: str,
        oos_completed: bool,
        walk_forward_completed: bool,
    ) -> EdgeMaturityStage:
        if not approved_by.strip():
            raise MaturityViolation(
                "promoção de maturidade exige aprovação humana identificada"
            )
        if not evidence_ref.strip():
            raise MaturityViolation("promoção de maturidade exige referência de evidência")
        cur, new = maturity_rank(self._stage), maturity_rank(target)
        if new <= cur:
            raise MaturityViolation(
                f"promote() só avança: {self._stage} -> {target} não é promoção"
            )
        if new - cur != 1:
            raise MaturityViolation(
                f"promoção deve ser de um degrau por vez: {self._stage} -> {target}"
            )
        if target is EdgeMaturityStage.SHADOW_MODE and not (
            oos_completed and walk_forward_completed
        ):
            raise MaturityViolation(
                "SHADOW_MODE exige out-of-sample e walk-forward concluídos"
            )
        if maturity_rank(target) > maturity_rank(EdgeMaturityStage.SHADOW_MODE):
            raise MaturityViolation(
                f"{target} indisponível nesta versão: execução real não implementada"
            )
        self._history.append(
            TransitionLog(
                self._stage.value,
                target.value,
                ensure_utc(at),
                "promoção aprovada",
                {"approved_by": approved_by, "evidence_ref": evidence_ref},
            )
        )
        self._stage = target
        return self._stage

    def demote(self, target: EdgeMaturityStage, at: datetime, reason: str) -> EdgeMaturityStage:
        if maturity_rank(target) >= maturity_rank(self._stage):
            raise MaturityViolation(
                f"demote() só retrocede: {self._stage} -> {target} não é rebaixamento"
            )
        self._history.append(
            TransitionLog(self._stage.value, target.value, ensure_utc(at), reason)
        )
        self._stage = target
        return self._stage
