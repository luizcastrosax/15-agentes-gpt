"""15. Broker Adapter — implementações READ_ONLY e SHADOW.

Nenhum adapter aqui fala com corretora. **Não existe adapter live nesta
versão** e o orquestrador recusa qualquer adapter que declare
``supports_live=True``.

- ``ReadOnlyBrokerAdapter``: recusa qualquer submissão. Usado no modo de
  observação puro.
- ``ShadowBrokerAdapter``: registra a intenção (plano completo, carimbado) sem
  qualquer efeito externo. É o que alimenta o relatório de shadow mode.

Estado de conta e posição vêm de fora (injetados), não são inventados: um
adapter que "supõe" equity ou "supõe" flat é a origem clássica de perdas
silenciosas.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

from ..domain.account import AccountState, PositionSnapshot
from ..domain.assessments import TradePlan
from ..domain.decision import digest_of
from ..domain.enums import ExecutionMode
from ..domain.errors import ExecutionModeViolation
from ..domain.timing import ensure_utc

__all__ = ["SimpleReceipt", "ReadOnlyBrokerAdapter", "ShadowBrokerAdapter", "ShadowIntent"]


@dataclass(frozen=True, slots=True)
class SimpleReceipt:
    receipt_id: str
    accepted: bool
    mode: ExecutionMode
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "accepted": self.accepted,
            "mode": str(self.mode),
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class ShadowIntent:
    """Intenção registrada em shadow mode. Nunca vira ordem."""

    receipt_id: str
    at: datetime
    tag: str
    plan: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "at": self.at.isoformat(),
            "tag": self.tag,
            "plan": dict(self.plan),
        }


class ReadOnlyBrokerAdapter:
    """Adapter que nunca aceita submissão."""

    supports_live = False

    def __init__(
        self,
        account: AccountState | None = None,
        position: PositionSnapshot | None = None,
        name: str = "read_only",
    ) -> None:
        self.name = name
        self.mode = ExecutionMode.READ_ONLY
        self._account = account
        self._position = position

    def account_state(self, as_of: datetime) -> AccountState | None:
        return self._account

    def position_snapshot(self, as_of: datetime) -> PositionSnapshot | None:
        return self._position

    def submit(self, plan: TradePlan, as_of: datetime, tag: str) -> SimpleReceipt:
        raise ExecutionModeViolation(
            "adapter READ_ONLY não submete ordens — nem simuladas"
        )

    def health(self) -> Mapping[str, Any]:
        return {
            "adapter": self.name,
            "mode": str(self.mode),
            "supports_live": False,
            "account_known": self._account is not None,
            "position_known": self._position is not None,
        }


class ShadowBrokerAdapter:
    """Adapter que registra intenções sem efeito externo."""

    supports_live = False

    def __init__(
        self,
        account: AccountState | None = None,
        position: PositionSnapshot | None = None,
        name: str = "shadow",
    ) -> None:
        self.name = name
        self.mode = ExecutionMode.SHADOW
        self._account = account
        self._position = position
        self.intents: list[ShadowIntent] = []

    def account_state(self, as_of: datetime) -> AccountState | None:
        return self._account

    def position_snapshot(self, as_of: datetime) -> PositionSnapshot | None:
        return self._position

    def submit(self, plan: TradePlan, as_of: datetime, tag: str) -> SimpleReceipt:
        at = ensure_utc(as_of)
        payload = plan.to_dict()
        receipt_id = "shadow_" + digest_of([at.isoformat(), tag, payload])[:16]
        self.intents.append(ShadowIntent(receipt_id, at, tag, payload))
        return SimpleReceipt(
            receipt_id=receipt_id,
            accepted=True,
            mode=ExecutionMode.SHADOW,
            detail=(
                f"intenção registrada em shadow mode ({plan.side} x{plan.quantity} "
                f"@ {plan.entry_price:.2f}); nenhuma ordem foi enviada"
            ),
        )

    def health(self) -> Mapping[str, Any]:
        return {
            "adapter": self.name,
            "mode": str(self.mode),
            "supports_live": False,
            "intents_recorded": len(self.intents),
            "account_known": self._account is not None,
            "position_known": self._position is not None,
        }
