"""Interfaces (Protocols) dos 15 módulos.

Usa ``typing.Protocol`` em vez de herança: os engines são substituíveis sem
acoplamento, o que é requisito para trocar a implementação baseline por uma
versão com dados melhores (order flow real, calendário institucional) sem
tocar no orquestrador.

Contrato comum a todos os engines:

1. São funções puras de ``EvaluationContext`` → assessment.
2. Não fazem I/O, não leem relógio do sistema, não usam aleatoriedade.
3. Nunca levantam exceção para condição de mercado; ausência de dado vira
   campo ``None`` / veredito ``NOT_AVAILABLE``.
4. São idempotentes: chamar duas vezes com o mesmo contexto dá o mesmo
   resultado (verificado em ``tests/causality``).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..domain.assessments import (
    AcceptanceAssessment,
    DataQualityReport,
    FlowAssessment,
    LiquidityAssessment,
    MacroAssessment,
    MaturityAssessment,
    PositionAssessment,
    RegimeAssessment,
    RiskAssessment,
    SessionState,
    StructureAssessment,
    TradePlan,
)
from ..domain.enums import Side
from .context import EvaluationContext

__all__ = [
    "DataQualityEngine",
    "SessionEngine",
    "MacroEngine",
    "MarketRegimeEngine",
    "StructureEngine",
    "LiquidityEngine",
    "AcceptanceEngine",
    "FlowEngine",
    "ExecutionEngine",
    "RiskEngine",
    "PositionStateRouter",
    "EdgeMaturityRegistry",
]


@runtime_checkable
class DataQualityEngine(Protocol):
    """1. Data Quality Engine — G0."""

    def assess(self, ctx: EvaluationContext) -> DataQualityReport: ...


@runtime_checkable
class SessionEngine(Protocol):
    """2. Session Engine — classifica a fase de sessão em ``as_of``."""

    def classify(self, ctx: EvaluationContext) -> SessionState: ...


@runtime_checkable
class MacroEngine(Protocol):
    """3. Macro Engine — G1 (blackout de eventos)."""

    def assess(self, ctx: EvaluationContext) -> MacroAssessment: ...


@runtime_checkable
class MarketRegimeEngine(Protocol):
    """4. Market Regime Engine — G2."""

    def assess(self, ctx: EvaluationContext) -> RegimeAssessment: ...


@runtime_checkable
class StructureEngine(Protocol):
    """5. Structure Engine — BOS/CHoCH confirmados por fechamento."""

    def assess(self, ctx: EvaluationContext) -> StructureAssessment: ...


@runtime_checkable
class LiquidityEngine(Protocol):
    """6. Liquidity Engine — G3 (pools e sweeps)."""

    def assess(self, ctx: EvaluationContext) -> LiquidityAssessment: ...


@runtime_checkable
class AcceptanceEngine(Protocol):
    """7. Acceptance Engine — G4 (rejeição × aceitação no nível varrido)."""

    def assess(
        self, ctx: EvaluationContext, liquidity: LiquidityAssessment
    ) -> AcceptanceAssessment: ...


@runtime_checkable
class FlowEngine(Protocol):
    """8. Flow Engine — G5."""

    def assess(self, ctx: EvaluationContext, side: Side | None) -> FlowAssessment: ...


@runtime_checkable
class ExecutionEngine(Protocol):
    """9. Execution Engine — G6 (constrói o plano; nunca envia ordem)."""

    def build_plan(
        self,
        ctx: EvaluationContext,
        side: Side,
        liquidity: LiquidityAssessment,
        acceptance: AcceptanceAssessment,
        quantity: int,
    ) -> TradePlan | None: ...

    def max_quantity_for_risk(
        self, ctx: EvaluationContext, risk_money_budget: float, stop_points: float
    ) -> int: ...


@runtime_checkable
class RiskEngine(Protocol):
    """10. Risk Engine — G7."""

    def assess(self, ctx: EvaluationContext, plan: TradePlan | None) -> RiskAssessment: ...

    def risk_budget(self, ctx: EvaluationContext) -> float | None: ...


@runtime_checkable
class PositionStateRouter(Protocol):
    """11. Position State Router — G8."""

    def assess(self, ctx: EvaluationContext) -> PositionAssessment: ...


@runtime_checkable
class EdgeMaturityRegistry(Protocol):
    """Suporte ao G9 — fonte de verdade sobre maturidade do setup."""

    def assess(self, ctx: EvaluationContext) -> MaturityAssessment: ...
