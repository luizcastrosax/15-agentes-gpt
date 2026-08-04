"""Contexto de avaliação — a única entrada dos engines.

Nenhum engine faz I/O. Todos recebem ``EvaluationContext`` e devolvem um
assessment. Consequências práticas:

- A decisão é **reprodutível**: mesmo contexto ⇒ mesma decisão.
- O backtest e o shadow mode compartilham exatamente o mesmo código de
  decisão; o que muda é apenas quem monta o contexto.
- Look-ahead fica confinado a *uma* superfície auditável: quem constrói o
  contexto. Os testes de causalidade atacam justamente essa superfície.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Sequence

from ..configuration.models import DeGoldConfig
from ..domain.account import AccountState, PositionSnapshot, SessionRiskLedger
from ..domain.events import MacroEvent
from ..domain.market import MarketSnapshot
from ..domain.timing import AsOf

__all__ = ["EvaluationContext"]


@dataclass(frozen=True, slots=True)
class EvaluationContext:
    """Tudo o que o sistema sabe no instante ``as_of``."""

    as_of: AsOf
    snapshot: MarketSnapshot
    config: DeGoldConfig
    #: ``None`` = calendário indisponível. Lista vazia = calendário disponível
    #: e sem eventos. A distinção é obrigatória (ausência ≠ zero).
    macro_events: Sequence[MacroEvent] | None = None
    account: AccountState | None = None
    position: PositionSnapshot | None = None
    risk_ledger: SessionRiskLedger | None = None
    #: Metadados livres para telemetria (id do run, nome do dataset, etc).
    meta: Mapping[str, Any] = field(default_factory=dict)

    @property
    def now(self) -> datetime:
        return self.as_of.ts

    def visible_macro_events(self) -> Sequence[MacroEvent] | None:
        """Eventos macro cuja publicação já era conhecida em ``as_of``.

        Um calendário baixado *hoje* contém revisões que não existiam na data
        histórica. Filtrar por ``available_at`` é o que impede que o backtest
        use conhecimento futuro sobre o calendário.
        """
        if self.macro_events is None:
            return None
        return tuple(e for e in self.macro_events if e.timing.visible_at(self.now))
