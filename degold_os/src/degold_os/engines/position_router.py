"""11. Position State Router (G8).

Decide se o estado atual de posição permite uma nova entrada.

Regra fail-closed: ``PositionSnapshot`` ausente ou obsoleto ⇒
``state_known=False`` ⇒ ``allows_new_entry=False``. Não saber se há posição
aberta é o pior estado possível para autorizar uma nova ordem; portanto
bloqueia.

Máquina de estados (ver ``orchestration/state_machines.py`` para as
transições completas): apenas ``FLAT`` autoriza nova entrada no MVP.
Pirâmide, escala e reversão direta ficam fora do escopo da v1.
"""

from __future__ import annotations

from ..contracts.context import EvaluationContext
from ..domain.assessments import PositionAssessment
from ..domain.enums import PositionState

__all__ = ["BaselinePositionStateRouter"]


class BaselinePositionStateRouter:
    def assess(self, ctx: EvaluationContext) -> PositionAssessment:
        snap = ctx.position

        if snap is None:
            return PositionAssessment(
                state=PositionState.BLOCKED,
                open_quantity=0,
                open_side=None,
                allows_new_entry=False,
                state_known=False,
                notes=(
                    "estado de posição indisponível: bloqueio por fail-closed "
                    "(desconhecido ≠ flat)",
                ),
            )

        if snap.is_stale(ctx.now):
            age = (ctx.now - snap.as_of).total_seconds()
            return PositionAssessment(
                state=PositionState.BLOCKED,
                open_quantity=snap.position.quantity if snap.position else 0,
                open_side=snap.position.side if snap.position else None,
                allows_new_entry=False,
                state_known=False,
                notes=(
                    f"snapshot de posição obsoleto: {age:.1f}s > "
                    f"{snap.max_age_seconds:.1f}s",
                ),
            )

        notes: list[str] = []
        allows = snap.state is PositionState.FLAT and snap.position is None

        if snap.pending_order_ids:
            allows = False
            notes.append(
                f"{len(snap.pending_order_ids)} ordens pendentes: nova entrada bloqueada"
            )
        if snap.position is not None:
            notes.append(
                f"posição aberta {snap.position.side} x{snap.position.quantity} "
                f"@ {snap.position.average_price:.2f}"
            )
        if snap.state is not PositionState.FLAT:
            notes.append(f"estado {snap.state} não autoriza nova entrada no MVP")
        if allows:
            notes.append("flat, sem ordens pendentes: entrada permitida")

        return PositionAssessment(
            state=snap.state,
            open_quantity=snap.position.quantity if snap.position else 0,
            open_side=snap.position.side if snap.position else None,
            allows_new_entry=allows,
            state_known=True,
            notes=tuple(notes),
        )
