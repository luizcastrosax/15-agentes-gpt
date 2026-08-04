"""Portas de saída: broker, telemetria e feature store.

São *portas* no sentido de arquitetura hexagonal: o núcleo depende da
interface, nunca do adapter concreto. Isso é o que permite garantir, por
construção, que a v1 não envia ordem real — basta que nenhum adapter capaz
disso exista.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from ..domain.account import AccountState, PositionSnapshot
from ..domain.assessments import TradePlan
from ..domain.decision import DecisionRecord
from ..domain.enums import ExecutionMode

__all__ = ["BrokerAdapter", "TelemetrySink", "FeatureStore", "OrderReceipt"]


class OrderReceipt(Protocol):
    """Recibo de submissão. Em v1 apenas adapters simulados o produzem."""

    receipt_id: str
    accepted: bool
    mode: ExecutionMode
    detail: str


@runtime_checkable
class BrokerAdapter(Protocol):
    """15. Broker Adapter.

    ``supports_live`` é a chave de segurança: o orquestrador recusa qualquer
    adapter com ``supports_live=True`` enquanto a v1 estiver vigente. Não
    existe adapter live nesta versão.
    """

    name: str
    mode: ExecutionMode
    supports_live: bool

    def account_state(self, as_of: datetime) -> AccountState | None: ...

    def position_snapshot(self, as_of: datetime) -> PositionSnapshot | None: ...

    def submit(self, plan: TradePlan, as_of: datetime, tag: str) -> OrderReceipt: ...

    def health(self) -> Mapping[str, Any]: ...


@runtime_checkable
class TelemetrySink(Protocol):
    """14. Telemetry."""

    def emit(self, event_type: str, payload: Mapping[str, Any]) -> None: ...

    def emit_decision(self, record: DecisionRecord) -> None: ...

    def flush(self) -> None: ...


@runtime_checkable
class FeatureStore(Protocol):
    """13. Feature Store.

    Regra inegociável: ``get`` só devolve features com
    ``available_at <= as_of``. A store é append-only; ``put`` de uma feature
    já existente com valor diferente é violação de causalidade.
    """

    def put(
        self,
        name: str,
        value: Any,
        as_of: datetime,
        available_at: datetime,
        meta: Mapping[str, Any] | None = None,
    ) -> None: ...

    def get(self, name: str, as_of: datetime) -> Any | None: ...

    def history(self, name: str, as_of: datetime) -> Sequence[Any]: ...
