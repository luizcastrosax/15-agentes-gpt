"""12. Decision Orchestrator.

Executa o pipeline canônico

    REGIME → LIQUIDITY → ACCEPTANCE → FLOW → EXECUTION

instrumentado pelos gates G0..G9, e produz um ``DecisionRecord`` explicável.

Garantias desta versão (verificadas por teste):

- ``ExecutionMode.LIVE`` é recusado na construção: não há caminho de execução
  real. Configurar ``LIVE`` aborta o boot, em vez de operar silenciosamente.
- ``BrokerAdapter`` com ``supports_live=True`` é recusado pelo mesmo motivo.
- Qualquer exceção durante a avaliação vira ``NO_TRADE`` com evidência: o
  sistema falha fechado, nunca "quase decide".
- A decisão máxima possível é ``SHADOW_INTENT``, e apenas com G9 aprovado.
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass
from typing import Any, Mapping

from ..contracts.context import EvaluationContext
from ..contracts.ports import BrokerAdapter, TelemetrySink
from ..domain.assessments import (
    AcceptanceAssessment,
    FlowAssessment,
    LiquidityAssessment,
    TradePlan,
)
from ..domain.decision import (
    DecisionRecord,
    GateEvaluation,
    GateResult,
    digest_of,
    make_decision_id,
)
from ..domain.enums import (
    Decision,
    ExecutionMode,
    GATE_ORDER,
    GateId,
    GateStatus,
    Side,
)
from ..domain.errors import DeGoldError, ExecutionModeViolation
from ..engines import (
    BaselineAcceptanceEngine,
    BaselineDataQualityEngine,
    BaselineExecutionEngine,
    BaselineFlowEngine,
    BaselineLiquidityEngine,
    BaselineMacroEngine,
    BaselinePositionStateRouter,
    BaselineRegimeEngine,
    BaselineRiskEngine,
    BaselineSessionEngine,
    BaselineStructureEngine,
    ConfigEdgeMaturityRegistry,
)
from ..telemetry.sinks import NullTelemetrySink
from . import gates as G

__all__ = ["DecisionOrchestrator", "EngineBundle"]


@dataclass(frozen=True, slots=True)
class EngineBundle:
    """Composição de engines. Trocar uma implementação é trocar um campo."""

    data_quality: Any = None
    session: Any = None
    macro: Any = None
    regime: Any = None
    structure: Any = None
    liquidity: Any = None
    acceptance: Any = None
    flow: Any = None
    execution: Any = None
    risk: Any = None
    position: Any = None
    maturity: Any = None

    @staticmethod
    def baseline() -> EngineBundle:
        return EngineBundle(
            data_quality=BaselineDataQualityEngine(),
            session=BaselineSessionEngine(),
            macro=BaselineMacroEngine(),
            regime=BaselineRegimeEngine(),
            structure=BaselineStructureEngine(),
            liquidity=BaselineLiquidityEngine(),
            acceptance=BaselineAcceptanceEngine(),
            flow=BaselineFlowEngine(),
            execution=BaselineExecutionEngine(),
            risk=BaselineRiskEngine(),
            position=BaselinePositionStateRouter(),
            maturity=ConfigEdgeMaturityRegistry(),
        )


class DecisionOrchestrator:
    def __init__(
        self,
        engines: EngineBundle | None = None,
        telemetry: TelemetrySink | None = None,
        broker: BrokerAdapter | None = None,
    ) -> None:
        self.engines = engines or EngineBundle.baseline()
        self.telemetry: TelemetrySink = telemetry or NullTelemetrySink()
        self.broker = broker
        if broker is not None and getattr(broker, "supports_live", False):
            raise ExecutionModeViolation(
                "broker com suporte a execução real recusado: v1 é READ_ONLY/SHADOW"
            )

    # -- API principal -----------------------------------------------------

    def evaluate(self, ctx: EvaluationContext) -> DecisionRecord:
        started = time.perf_counter()
        mode = ctx.config.runtime.execution_mode
        if mode is ExecutionMode.LIVE:
            raise ExecutionModeViolation(
                "ExecutionMode.LIVE não é suportado nesta versão. "
                "O sistema recusa iniciar em modo live."
            )

        try:
            record = self._evaluate_inner(ctx, started)
        except DeGoldError as exc:
            record = self._failure_record(ctx, started, exc)
        except Exception as exc:  # noqa: BLE001 — fail-closed é o ponto
            record = self._failure_record(ctx, started, exc, unexpected=True)

        if ctx.config.telemetry.enabled and (
            ctx.config.telemetry.log_all_decisions
            or record.decision is not Decision.NO_TRADE
        ):
            self.telemetry.emit_decision(record)
        return record

    # -- pipeline ----------------------------------------------------------

    def _evaluate_inner(self, ctx: EvaluationContext, started: float) -> DecisionRecord:
        policy = ctx.config.gates
        results: list[GateResult] = []
        assessments: dict[str, Any] = {}
        warnings: list[str] = []

        def push(result: GateResult) -> bool:
            """Registra o gate e devolve False se ele bloqueia o pipeline."""
            result = GateResult(
                gate=result.gate,
                status=result.status,
                reasons=result.reasons,
                evidence=result.evidence,
                critical=G.is_critical(result.gate, policy),
                uses_proxy=result.uses_proxy,
            )
            results.append(result)
            eff = G.effective_status(result, policy)
            return not (result.critical and eff is GateStatus.FAIL)

        session = self.engines.session.classify(ctx)
        assessments["session"] = session.to_dict()

        # --- G0 DATA ------------------------------------------------------
        dq = self.engines.data_quality.assess(ctx)
        assessments["data_quality"] = dq.to_dict()
        if not push(G.gate_g0_data(ctx, dq)):
            return self._finish(ctx, started, results, GateId.G0_DATA, assessments, None, warnings)

        # --- G1 MACRO -----------------------------------------------------
        macro = self.engines.macro.assess(ctx)
        assessments["macro"] = macro.to_dict()
        if not push(G.gate_g1_macro(ctx, macro)):
            return self._finish(ctx, started, results, GateId.G1_MACRO, assessments, None, warnings)

        # --- G2 REGIME ----------------------------------------------------
        regime = self.engines.regime.assess(ctx)
        assessments["regime"] = regime.to_dict()
        if not push(G.gate_g2_regime(ctx, regime, session)):
            return self._finish(ctx, started, results, GateId.G2_REGIME, assessments, None, warnings)

        # --- G3 LIQUIDITY -------------------------------------------------
        liquidity: LiquidityAssessment = self.engines.liquidity.assess(ctx)
        assessments["liquidity"] = liquidity.to_dict()
        if not push(G.gate_g3_liquidity(ctx, liquidity)):
            return self._finish(
                ctx, started, results, GateId.G3_LIQUIDITY, assessments, None, warnings
            )

        # --- G4 INTERACTION ----------------------------------------------
        structure = self.engines.structure.assess(ctx)
        acceptance: AcceptanceAssessment = self.engines.acceptance.assess(ctx, liquidity)
        assessments["structure"] = structure.to_dict()
        assessments["acceptance"] = acceptance.to_dict()
        if not push(G.gate_g4_interaction(ctx, acceptance, structure, liquidity)):
            return self._finish(
                ctx, started, results, GateId.G4_INTERACTION, assessments, None, warnings
            )

        side: Side | None = acceptance.side or (
            liquidity.active_sweep.side if liquidity.active_sweep else None
        )

        # --- G5 FLOW ------------------------------------------------------
        flow: FlowAssessment = self.engines.flow.assess(ctx, side)
        assessments["flow"] = flow.to_dict()
        if not push(G.gate_g5_flow(ctx, flow)):
            return self._finish(ctx, started, results, GateId.G5_FLOW, assessments, None, warnings)

        # --- G6 EXECUTION -------------------------------------------------
        plan: TradePlan | None = None
        if side is None:
            warnings.append("lado indefinido após G4/G5: nenhum plano construído")
        else:
            budget = self.engines.risk.risk_budget(ctx)
            if budget is None:
                warnings.append(
                    "orçamento de risco desconhecido: dimensionamento impossível"
                )
            else:
                probe = self.engines.execution.build_plan(ctx, side, liquidity, acceptance, 1)
                if probe is not None:
                    qty = self.engines.execution.max_quantity_for_risk(
                        ctx, budget, probe.risk_points
                    )
                    if qty >= 1:
                        plan = self.engines.execution.build_plan(
                            ctx, side, liquidity, acceptance, qty
                        )
                    else:
                        warnings.append(
                            f"orçamento {budget:.2f} insuficiente para 1 contrato "
                            f"(risco/contrato {probe.risk_money:.2f})"
                        )
        assessments["plan"] = plan.to_dict() if plan else None
        if not push(G.gate_g6_execution(ctx, plan)):
            return self._finish(
                ctx, started, results, GateId.G6_EXECUTION, assessments, None, warnings
            )

        # --- G7 RISK ------------------------------------------------------
        risk = self.engines.risk.assess(ctx, plan)
        assessments["risk"] = risk.to_dict()
        if not push(G.gate_g7_risk(ctx, risk)):
            return self._finish(ctx, started, results, GateId.G7_RISK, assessments, None, warnings)

        # --- G8 POSITION --------------------------------------------------
        position = self.engines.position.assess(ctx)
        assessments["position"] = position.to_dict()
        if not push(G.gate_g8_position(ctx, position)):
            return self._finish(
                ctx, started, results, GateId.G8_POSITION, assessments, None, warnings
            )

        # --- G9 EDGE MATURITY ---------------------------------------------
        maturity = self.engines.maturity.assess(ctx)
        assessments["maturity"] = maturity.to_dict()
        if not push(G.gate_g9_edge_maturity(ctx, maturity)):
            return self._finish(
                ctx, started, results, GateId.G9_EDGE_MATURITY, assessments, None, warnings
            )

        return self._finish(ctx, started, results, None, assessments, plan, warnings)

    # -- agregação ---------------------------------------------------------

    def _finish(
        self,
        ctx: EvaluationContext,
        started: float,
        results: list[GateResult],
        short_circuit: GateId | None,
        assessments: Mapping[str, Any],
        plan: TradePlan | None,
        warnings: list[str],
    ) -> DecisionRecord:
        evaluation = GateEvaluation(tuple(results), short_circuit)
        decision = self._aggregate(ctx, evaluation, plan, warnings)

        if decision is not Decision.SHADOW_INTENT:
            plan = None

        if decision is Decision.SHADOW_INTENT and self.broker is not None and plan is not None:
            receipt = self.broker.submit(plan, ctx.now, tag=ctx.config.maturity.setup_id)
            warnings.append(f"shadow submit: {receipt.detail}")

        inputs_digest = _inputs_digest(ctx)
        eval_ms = (time.perf_counter() - started) * 1000.0

        record = DecisionRecord(
            decision_id=make_decision_id(ctx.now, ctx.config.instrument.symbol, inputs_digest),
            as_of=ctx.now,
            instrument=ctx.config.instrument.symbol,
            execution_mode=ctx.config.runtime.execution_mode,
            session_phase=_session_phase(assessments),
            decision=decision,
            gates=evaluation,
            trade_plan=plan.to_dict() if plan else None,
            assessments=dict(assessments),
            code_version=ctx.config.runtime.code_version,
            ruleset_version=ctx.config.runtime.ruleset_version,
            config_hash=ctx.config.config_hash,
            inputs_digest=inputs_digest,
            eval_ms=eval_ms,
            warnings=tuple(warnings),
        )
        return record

    def _aggregate(
        self,
        ctx: EvaluationContext,
        evaluation: GateEvaluation,
        plan: TradePlan | None,
        warnings: list[str],
    ) -> Decision:
        policy = ctx.config.gates
        mode = ctx.config.runtime.execution_mode

        evaluated = {r.gate for r in evaluation.results}
        if set(GATE_ORDER) - evaluated:
            return Decision.NO_TRADE

        conditional = 0
        for r in evaluation.results:
            eff = G.effective_status(r, policy)
            if eff is GateStatus.FAIL and r.critical:
                return Decision.NO_TRADE
            if eff is GateStatus.CONDITIONAL:
                conditional += 1
            if eff is GateStatus.FAIL and not r.critical:
                warnings.append(f"{r.gate} FAIL não-crítico tolerado por política")

        if conditional > policy.max_conditional_gates:
            warnings.append(
                f"{conditional} gates CONDITIONAL > limite {policy.max_conditional_gates}"
            )
            return Decision.NO_TRADE

        if plan is None:
            return Decision.NO_TRADE

        if mode is ExecutionMode.READ_ONLY:
            warnings.append(
                "todos os gates aprovados, mas ExecutionMode=READ_ONLY: "
                "nenhuma intenção é emitida"
            )
            return Decision.OBSERVE

        g9 = evaluation.by_id(GateId.G9_EDGE_MATURITY)
        if g9 is None or G.effective_status(g9, policy) is GateStatus.FAIL:
            return Decision.NO_TRADE

        return Decision.SHADOW_INTENT

    # -- falha -------------------------------------------------------------

    def _failure_record(
        self,
        ctx: EvaluationContext,
        started: float,
        exc: BaseException,
        unexpected: bool = False,
    ) -> DecisionRecord:
        reason = f"{type(exc).__name__}: {exc}"
        gate = GateResult.fail(
            GateId.G0_DATA,
            "falha durante a avaliação — política fail-closed aplicada",
            reason,
            evidence={
                "traceback": traceback.format_exc(limit=8) if unexpected else "",
                "unexpected": unexpected,
            },
        )
        evaluation = GateEvaluation((gate,), GateId.G0_DATA)
        return DecisionRecord(
            decision_id=make_decision_id(ctx.now, ctx.config.instrument.symbol, reason),
            as_of=ctx.now,
            instrument=ctx.config.instrument.symbol,
            execution_mode=ctx.config.runtime.execution_mode,
            session_phase=_session_phase({}),
            decision=Decision.NO_TRADE,
            gates=evaluation,
            trade_plan=None,
            assessments={},
            code_version=ctx.config.runtime.code_version,
            ruleset_version=ctx.config.runtime.ruleset_version,
            config_hash=ctx.config.config_hash,
            inputs_digest=_inputs_digest(ctx),
            eval_ms=(time.perf_counter() - started) * 1000.0,
            warnings=(reason,),
        )


def _session_phase(assessments: Mapping[str, Any]):
    from ..domain.enums import SessionPhase

    raw = assessments.get("session")
    if isinstance(raw, dict) and "phase" in raw:
        try:
            return SessionPhase(raw["phase"])
        except ValueError:  # pragma: no cover - defensivo
            return SessionPhase.UNKNOWN
    return SessionPhase.UNKNOWN


def _inputs_digest(ctx: EvaluationContext) -> str:
    """Digest das entradas relevantes — permite reproduzir a decisão."""
    payload = {
        "as_of": ctx.now.isoformat(),
        "instrument": ctx.config.instrument.symbol,
        "series": {
            str(tf): [
                b.to_dict()
                for b in series.closed_as_of(ctx.now)[-5:]  # cauda basta p/ identificar
            ]
            for tf, series in ctx.snapshot.series.items()
        },
        "quote": (
            None
            if ctx.snapshot.quote is None
            else {
                "bid": ctx.snapshot.quote.bid,
                "ask": ctx.snapshot.quote.ask,
                "ts": ctx.snapshot.quote.ts.isoformat(),
            }
        ),
        "macro": (
            None
            if ctx.macro_events is None
            else [e.event_id for e in ctx.visible_macro_events() or ()]
        ),
        "account": ctx.account.to_dict() if ctx.account else None,
        "position": ctx.position.to_dict() if ctx.position else None,
        "ledger": ctx.risk_ledger.to_dict() if ctx.risk_ledger else None,
    }
    return digest_of(payload)
