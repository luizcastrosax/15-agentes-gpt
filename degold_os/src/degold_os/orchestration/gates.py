"""Decision Gates G0..G9.

Cada gate é uma função pura ``(ctx, assessments...) -> GateResult``. Elas não
decidem *o que fazer*: apenas emitem veredito e evidência. A agregação é do
orquestrador.

Convenções aplicadas uniformemente:

- ``PASS``          — condição satisfeita com dado direto/derivado.
- ``CONDITIONAL``   — condição satisfeita, mas com proxy, baixa amostra ou
                      margem apertada. Nunca autoriza sozinha.
- ``FAIL``          — condição violada. Em gate crítico ⇒ NO_TRADE imediato.
- ``NOT_AVAILABLE`` — não foi possível avaliar. A política
                      ``gates.treat_not_available_as`` define o efeito.

Regra transversal: **qualquer gate cujo insumo seja proxy não pode retornar
PASS.** Isso é imposto por ``_demote_if_proxy``.
"""

from __future__ import annotations

from typing import Any, Mapping

from ..contracts.context import EvaluationContext
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
from ..domain.decision import GateResult
from ..domain.enums import (
    AcceptanceVerdict,
    DataQualityStatus,
    FlowVerdict,
    GateId,
    GateStatus,
    MarketRegime,
    SessionPhase,
    Side,
    StructureEvent,
    SweepOutcome,
    TrendDirection,
    maturity_rank,
)
from ..configuration.models import GatePolicy

__all__ = [
    "gate_g0_data",
    "gate_g1_macro",
    "gate_g2_regime",
    "gate_g3_liquidity",
    "gate_g4_interaction",
    "gate_g5_flow",
    "gate_g6_execution",
    "gate_g7_risk",
    "gate_g8_position",
    "gate_g9_edge_maturity",
    "effective_status",
    "is_critical",
]


def _demote_if_proxy(result: GateResult) -> GateResult:
    """PASS com proxy vira CONDITIONAL. Sem exceções."""
    if result.status is GateStatus.PASS and result.uses_proxy:
        return GateResult(
            gate=result.gate,
            status=GateStatus.CONDITIONAL,
            reasons=("insumo baseado em proxy: PASS rebaixado a CONDITIONAL",),
            evidence=result.evidence,
            critical=result.critical,
            uses_proxy=True,
        )
    return result


def effective_status(result: GateResult, policy: GatePolicy) -> GateStatus:
    """Status após aplicar a política para ``NOT_AVAILABLE``."""
    if result.status is GateStatus.NOT_AVAILABLE:
        return policy.treat_not_available_as
    return result.status


def is_critical(gate: GateId, policy: GatePolicy) -> bool:
    return str(gate) not in policy.non_critical_gates


# ---------------------------------------------------------------------------
# G0 — DATA
# ---------------------------------------------------------------------------


def gate_g0_data(ctx: EvaluationContext, report: DataQualityReport) -> GateResult:
    ev: Mapping[str, Any] = {"report": report.to_dict()}
    if report.status is DataQualityStatus.NOT_AVAILABLE:
        return GateResult.not_available(
            GateId.G0_DATA, "dados de mercado indisponíveis", evidence=ev
        )
    if report.status is DataQualityStatus.UNUSABLE:
        return GateResult.fail(
            GateId.G0_DATA,
            *(report.notes or ("qualidade de dados inutilizável",)),
            evidence=ev,
        )
    if report.status is DataQualityStatus.DEGRADED:
        return GateResult.conditional(
            GateId.G0_DATA,
            *(report.notes or ("qualidade de dados degradada",)),
            evidence=ev,
        )
    return GateResult.pass_(GateId.G0_DATA, evidence=ev)


# ---------------------------------------------------------------------------
# G1 — MACRO
# ---------------------------------------------------------------------------


def gate_g1_macro(ctx: EvaluationContext, macro: MacroAssessment) -> GateResult:
    ev = {"macro": macro.to_dict()}
    if not macro.calendar_available:
        if ctx.config.macro.require_calendar:
            return GateResult.not_available(
                GateId.G1_MACRO,
                "calendário macro exigido e indisponível",
                evidence=ev,
            )
        return GateResult.conditional(
            GateId.G1_MACRO,
            "calendário macro indisponível e não exigido por configuração",
            evidence=ev,
        )
    if macro.in_blackout:
        return GateResult.fail(
            GateId.G1_MACRO,
            f"blackout macro ativo: {macro.blocking_event_name}",
            evidence=ev,
        )
    return GateResult.pass_(GateId.G1_MACRO, evidence=ev)


# ---------------------------------------------------------------------------
# G2 — REGIME
# ---------------------------------------------------------------------------


def gate_g2_regime(
    ctx: EvaluationContext, regime: RegimeAssessment, session: SessionState
) -> GateResult:
    ev = {"regime": regime.to_dict(), "session": session.to_dict()}
    allowed = set(ctx.config.regime.allowed_regimes)

    if regime.regime is MarketRegime.UNKNOWN:
        return GateResult.not_available(
            GateId.G2_REGIME,
            *(regime.notes or ("regime indeterminado",)),
            evidence=ev,
        )
    if session.phase in (SessionPhase.MARKET_CLOSED, SessionPhase.UNKNOWN):
        return GateResult.fail(
            GateId.G2_REGIME, f"fase de sessão não operável: {session.phase}", evidence=ev
        )
    if not session.is_tradable_window:
        return GateResult.fail(
            GateId.G2_REGIME,
            f"fora da janela operável (fase={session.phase})",
            evidence=ev,
        )
    if str(regime.regime) not in allowed:
        return GateResult.fail(
            GateId.G2_REGIME,
            f"regime {regime.regime} fora de allowed_regimes={sorted(allowed)}",
            evidence=ev,
        )
    if regime.volatility.value == "UNKNOWN":
        return GateResult.conditional(
            GateId.G2_REGIME,
            "regime de volatilidade desconhecido (histórico curto)",
            evidence=ev,
            uses_proxy=regime.uses_proxy,
        )
    if regime.volatility.value == "EXTREME":
        return GateResult.fail(
            GateId.G2_REGIME,
            "volatilidade EXTREME: fora do envelope operacional do setup",
            evidence=ev,
        )
    return _demote_if_proxy(
        GateResult.pass_(GateId.G2_REGIME, evidence=ev, uses_proxy=regime.uses_proxy)
    )


# ---------------------------------------------------------------------------
# G3 — LIQUIDITY
# ---------------------------------------------------------------------------


def gate_g3_liquidity(ctx: EvaluationContext, liq: LiquidityAssessment) -> GateResult:
    ev = {"liquidity": liq.to_dict()}
    if not liq.pools:
        return GateResult.not_available(
            GateId.G3_LIQUIDITY, "nenhum pool de liquidez construído", evidence=ev
        )
    sweep = liq.active_sweep
    if sweep is None:
        return GateResult.fail(
            GateId.G3_LIQUIDITY,
            "nenhum sweep confirmado e válido em as_of",
            evidence=ev,
            uses_proxy=liq.uses_proxy,
        )
    if sweep.outcome is not SweepOutcome.REJECTED:
        return GateResult.fail(
            GateId.G3_LIQUIDITY,
            f"sweep ativo com desfecho {sweep.outcome}, esperado REJECTED",
            evidence=ev,
            uses_proxy=liq.uses_proxy,
        )
    if not sweep.timing.is_confirmed:
        return GateResult.fail(
            GateId.G3_LIQUIDITY,
            "sweep não confirmado por fechamento de barra",
            evidence=ev,
            uses_proxy=liq.uses_proxy,
        )
    return _demote_if_proxy(
        GateResult.pass_(GateId.G3_LIQUIDITY, evidence=ev, uses_proxy=liq.uses_proxy)
    )


# ---------------------------------------------------------------------------
# G4 — INTERACTION (aceitação + estrutura)
# ---------------------------------------------------------------------------


def gate_g4_interaction(
    ctx: EvaluationContext,
    acceptance: AcceptanceAssessment,
    structure: StructureAssessment,
    liq: LiquidityAssessment,
) -> GateResult:
    ev = {
        "acceptance": acceptance.to_dict(),
        "structure": structure.to_dict(),
    }
    if acceptance.verdict is AcceptanceVerdict.NOT_AVAILABLE:
        return GateResult.not_available(
            GateId.G4_INTERACTION,
            *(acceptance.notes or ("aceitação não avaliável",)),
            evidence=ev,
        )
    if acceptance.verdict is AcceptanceVerdict.ACCEPTANCE:
        return GateResult.fail(
            GateId.G4_INTERACTION,
            "mercado aceitou além do nível varrido: setup de reversão invalidado",
            evidence=ev,
            uses_proxy=acceptance.uses_proxy,
        )
    if acceptance.verdict is AcceptanceVerdict.INDECISION:
        return GateResult.fail(
            GateId.G4_INTERACTION,
            "indecisão no nível varrido: sem rejeição caracterizada",
            evidence=ev,
            uses_proxy=acceptance.uses_proxy,
        )

    side = acceptance.side
    expected = {
        Side.SHORT: (StructureEvent.CHOCH_DOWN, StructureEvent.BOS_DOWN),
        Side.LONG: (StructureEvent.CHOCH_UP, StructureEvent.BOS_UP),
    }.get(side or Side.LONG, ())

    if structure.last_event is StructureEvent.NONE:
        return GateResult.conditional(
            GateId.G4_INTERACTION,
            "rejeição confirmada, mas sem confirmação estrutural em "
            f"{structure.timeframe}",
            evidence=ev,
            uses_proxy=acceptance.uses_proxy,
        )
    if structure.last_event not in expected:
        return GateResult.fail(
            GateId.G4_INTERACTION,
            f"estrutura {structure.last_event} contraria o lado {side}",
            evidence=ev,
            uses_proxy=acceptance.uses_proxy,
        )

    aligned = (side is Side.SHORT and structure.direction is TrendDirection.DOWN) or (
        side is Side.LONG and structure.direction is TrendDirection.UP
    )
    if not aligned:
        return GateResult.conditional(
            GateId.G4_INTERACTION,
            f"direção estrutural {structure.direction} não confirma o lado {side}",
            evidence=ev,
            uses_proxy=acceptance.uses_proxy,
        )

    return _demote_if_proxy(
        GateResult.pass_(
            GateId.G4_INTERACTION, evidence=ev, uses_proxy=acceptance.uses_proxy
        )
    )


# ---------------------------------------------------------------------------
# G5 — FLOW
# ---------------------------------------------------------------------------


def gate_g5_flow(ctx: EvaluationContext, flow: FlowAssessment) -> GateResult:
    ev = {"flow": flow.to_dict()}
    if flow.verdict is FlowVerdict.NOT_AVAILABLE:
        return GateResult.not_available(
            GateId.G5_FLOW, *(flow.notes or ("fluxo não avaliável",)), evidence=ev
        )
    if flow.verdict is FlowVerdict.OPPOSED:
        return GateResult.fail(
            GateId.G5_FLOW,
            "fluxo (proxy) contrário ao lado avaliado",
            evidence=ev,
            uses_proxy=flow.uses_proxy,
        )
    if flow.verdict is FlowVerdict.NEUTRAL:
        return GateResult.conditional(
            GateId.G5_FLOW,
            "fluxo (proxy) neutro: não confirma nem contraria",
            evidence=ev,
            uses_proxy=flow.uses_proxy,
        )
    return _demote_if_proxy(
        GateResult.pass_(GateId.G5_FLOW, evidence=ev, uses_proxy=flow.uses_proxy)
    )


# ---------------------------------------------------------------------------
# G6 — EXECUTION
# ---------------------------------------------------------------------------


def gate_g6_execution(ctx: EvaluationContext, plan: TradePlan | None) -> GateResult:
    if plan is None:
        return GateResult.fail(
            GateId.G6_EXECUTION,
            "não foi possível construir um plano executável "
            "(geometria fora dos limites de stop, ou dimensionamento zero)",
            evidence={},
        )
    ev = {"plan": plan.to_dict()}
    cfg = ctx.config.execution
    if plan.rr_net is None:
        return GateResult.not_available(
            GateId.G6_EXECUTION, "R:R líquido não calculável", evidence=ev
        )
    if plan.rr_net < cfg.min_rr_net:
        return GateResult.fail(
            GateId.G6_EXECUTION,
            f"R:R líquido {plan.rr_net:.2f} < mínimo {cfg.min_rr_net:.2f}",
            evidence=ev,
        )
    uses_proxy = bool(plan.cost_points is not None and plan.cost_points.is_proxy)
    return _demote_if_proxy(
        GateResult.pass_(GateId.G6_EXECUTION, evidence=ev, uses_proxy=uses_proxy)
    )


# ---------------------------------------------------------------------------
# G7 — RISK
# ---------------------------------------------------------------------------


def gate_g7_risk(ctx: EvaluationContext, risk: RiskAssessment) -> GateResult:
    ev = {"risk": risk.to_dict()}
    if not risk.account_state_known:
        return GateResult.not_available(
            GateId.G7_RISK,
            *(risk.notes or ("estado de risco desconhecido",)),
            evidence=ev,
        )
    if not risk.approved:
        reasons = [str(b) for b in risk.breaches] or list(risk.notes) or ["risco reprovado"]
        return GateResult.fail(GateId.G7_RISK, *reasons, evidence=ev)
    return GateResult.pass_(GateId.G7_RISK, evidence=ev)


# ---------------------------------------------------------------------------
# G8 — POSITION
# ---------------------------------------------------------------------------


def gate_g8_position(ctx: EvaluationContext, position: PositionAssessment) -> GateResult:
    ev = {"position": position.to_dict()}
    if not position.state_known:
        return GateResult.not_available(
            GateId.G8_POSITION,
            *(position.notes or ("estado de posição desconhecido",)),
            evidence=ev,
        )
    if not position.allows_new_entry:
        return GateResult.fail(
            GateId.G8_POSITION,
            *(position.notes or (f"estado {position.state} não permite nova entrada",)),
            evidence=ev,
        )
    return GateResult.pass_(GateId.G8_POSITION, evidence=ev)


# ---------------------------------------------------------------------------
# G9 — EDGE MATURITY
# ---------------------------------------------------------------------------


def gate_g9_edge_maturity(
    ctx: EvaluationContext, maturity: MaturityAssessment
) -> GateResult:
    ev = {"maturity": maturity.to_dict()}
    required = ctx.config.maturity.min_stage_for_shadow

    if maturity_rank(maturity.stage) < maturity_rank(required):
        return GateResult.fail(
            GateId.G9_EDGE_MATURITY,
            f"estágio {maturity.stage} abaixo do mínimo {required} para shadow mode",
            *maturity.notes,
            evidence=ev,
        )
    if not (maturity.oos_completed and maturity.walk_forward_completed):
        return GateResult.fail(
            GateId.G9_EDGE_MATURITY,
            "shadow mode exige OOS e walk-forward concluídos e registrados",
            evidence=ev,
        )
    if maturity.evidence_ref is None:
        return GateResult.conditional(
            GateId.G9_EDGE_MATURITY,
            "estágio declarado sem referência de evidência anexada",
            evidence=ev,
        )
    return GateResult.pass_(GateId.G9_EDGE_MATURITY, evidence=ev)
