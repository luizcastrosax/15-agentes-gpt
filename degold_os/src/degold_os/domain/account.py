"""Estado de conta e de posição.

``None`` em qualquer destes objetos significa **desconhecido**, e desconhecido
bloqueia entrada (fail-closed). Em particular, ``AccountState`` ausente não é
"conta zerada": é ``RiskBreach.RISK_STATE_UNKNOWN``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .enums import PositionState, Side
from .timing import ensure_utc

__all__ = ["AccountState", "OpenPosition", "PositionSnapshot", "SessionRiskLedger"]


@dataclass(frozen=True, slots=True)
class AccountState:
    equity: float
    currency: str
    as_of: datetime
    #: Idade máxima aceitável do snapshot antes de ser considerado obsoleto.
    max_age_seconds: float = 60.0
    broker: str = "unknown"

    def __post_init__(self) -> None:
        object.__setattr__(self, "as_of", ensure_utc(self.as_of))

    def is_stale(self, now: datetime) -> bool:
        return (ensure_utc(now) - self.as_of).total_seconds() > self.max_age_seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "equity": self.equity,
            "currency": self.currency,
            "as_of": self.as_of.isoformat(),
            "broker": self.broker,
        }


@dataclass(frozen=True, slots=True)
class OpenPosition:
    side: Side
    quantity: int
    average_price: float
    opened_at: datetime
    stop_price: float | None = None
    target_price: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "opened_at", ensure_utc(self.opened_at))

    def to_dict(self) -> dict[str, Any]:
        return {
            "side": str(self.side),
            "quantity": self.quantity,
            "average_price": self.average_price,
            "opened_at": self.opened_at.isoformat(),
            "stop_price": self.stop_price,
            "target_price": self.target_price,
        }


@dataclass(frozen=True, slots=True)
class PositionSnapshot:
    """Foto da posição segundo o broker/simulador, com carimbo de frescor."""

    state: PositionState
    as_of: datetime
    position: OpenPosition | None = None
    pending_order_ids: tuple[str, ...] = ()
    max_age_seconds: float = 30.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "as_of", ensure_utc(self.as_of))

    def is_stale(self, now: datetime) -> bool:
        return (ensure_utc(now) - self.as_of).total_seconds() > self.max_age_seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": str(self.state),
            "as_of": self.as_of.isoformat(),
            "position": self.position.to_dict() if self.position else None,
            "pending_order_ids": list(self.pending_order_ids),
        }


@dataclass(frozen=True, slots=True)
class SessionRiskLedger:
    """Consumo de risco já realizado na sessão corrente.

    Campos ``None`` = desconhecido ⇒ o Risk Engine reprova por
    ``RISK_STATE_UNKNOWN``. Nunca assuma 0 perdas por falta de dado.
    """

    session_date: str
    realized_pnl: float | None = None
    trades_taken: int | None = None
    consecutive_losses: int | None = None
    open_risk: float | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_date": self.session_date,
            "realized_pnl": self.realized_pnl,
            "trades_taken": self.trades_taken,
            "consecutive_losses": self.consecutive_losses,
            "open_risk": self.open_risk,
            "notes": list(self.notes),
        }
