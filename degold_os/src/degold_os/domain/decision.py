"""Resultado de gate e registro de decisão auditável.

``DecisionRecord`` é o artefato central de auditoria: dado o registro, um
terceiro deve conseguir dizer *por que* o sistema decidiu o que decidiu, com
qual versão de regras, sobre quais entradas, e o que estava indisponível.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from .enums import (
    Decision,
    ExecutionMode,
    GateId,
    GateStatus,
    SessionPhase,
)
from .errors import ContractViolation
from .timing import ensure_utc

__all__ = [
    "GateResult",
    "GateEvaluation",
    "DecisionRecord",
    "digest_of",
]


def digest_of(payload: Any) -> str:
    """Digest estável de qualquer estrutura serializável (auditoria)."""
    blob = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


@dataclass(frozen=True, slots=True)
class GateResult:
    """Veredito de um gate.

    ``reasons`` é obrigatório para qualquer status que não seja ``PASS``:
    um bloqueio sem razão legível não é auditável.
    """

    gate: GateId
    status: GateStatus
    reasons: tuple[str, ...] = ()
    evidence: Mapping[str, Any] = field(default_factory=dict)
    #: Se True, FAIL neste gate força NO_TRADE imediatamente.
    critical: bool = True
    #: True quando qualquer insumo do gate veio de proxy.
    uses_proxy: bool = False

    def __post_init__(self) -> None:
        if self.status is not GateStatus.PASS and not self.reasons:
            raise ContractViolation(
                f"gate {self.gate} com status {self.status} exige ao menos uma razão"
            )

    @property
    def blocks(self) -> bool:
        return self.critical and self.status is GateStatus.FAIL

    def to_dict(self) -> dict[str, Any]:
        return {
            "gate": str(self.gate),
            "status": str(self.status),
            "reasons": list(self.reasons),
            "evidence": dict(self.evidence),
            "critical": self.critical,
            "uses_proxy": self.uses_proxy,
        }

    # -- construtores de conveniência -------------------------------------

    @classmethod
    def pass_(
        cls,
        gate: GateId,
        evidence: Mapping[str, Any] | None = None,
        uses_proxy: bool = False,
        critical: bool = True,
    ) -> GateResult:
        return cls(gate, GateStatus.PASS, (), evidence or {}, critical, uses_proxy)

    @classmethod
    def conditional(
        cls,
        gate: GateId,
        *reasons: str,
        evidence: Mapping[str, Any] | None = None,
        uses_proxy: bool = False,
        critical: bool = True,
    ) -> GateResult:
        return cls(gate, GateStatus.CONDITIONAL, reasons, evidence or {}, critical, uses_proxy)

    @classmethod
    def fail(
        cls,
        gate: GateId,
        *reasons: str,
        evidence: Mapping[str, Any] | None = None,
        uses_proxy: bool = False,
        critical: bool = True,
    ) -> GateResult:
        return cls(gate, GateStatus.FAIL, reasons, evidence or {}, critical, uses_proxy)

    @classmethod
    def not_available(
        cls,
        gate: GateId,
        *reasons: str,
        evidence: Mapping[str, Any] | None = None,
        critical: bool = True,
    ) -> GateResult:
        return cls(gate, GateStatus.NOT_AVAILABLE, reasons, evidence or {}, critical, False)


@dataclass(frozen=True, slots=True)
class GateEvaluation:
    """Sequência avaliada de gates e o veredito agregado."""

    results: tuple[GateResult, ...]
    short_circuited_at: GateId | None = None

    def by_id(self, gate: GateId) -> GateResult | None:
        for r in self.results:
            if r.gate is gate:
                return r
        return None

    @property
    def any_blocking(self) -> bool:
        return any(r.blocks for r in self.results)

    @property
    def uses_proxy(self) -> bool:
        return any(r.uses_proxy for r in self.results)

    @property
    def statuses(self) -> dict[str, str]:
        return {str(r.gate): str(r.status) for r in self.results}

    def to_dict(self) -> dict[str, Any]:
        return {
            "results": [r.to_dict() for r in self.results],
            "short_circuited_at": (
                str(self.short_circuited_at) if self.short_circuited_at else None
            ),
        }


@dataclass(frozen=True, slots=True)
class DecisionRecord:
    """Registro imutável, versionado e explicável de uma avaliação.

    Reprodutibilidade: ``inputs_digest`` + ``config_hash`` + ``code_version``
    + ``ruleset_version`` identificam univocamente o cálculo. Duas execuções
    com os mesmos quatro valores devem produzir a mesma decisão.
    """

    decision_id: str
    as_of: datetime
    instrument: str
    execution_mode: ExecutionMode
    session_phase: SessionPhase
    decision: Decision
    gates: GateEvaluation
    #: Plano serializado (``TradePlan.to_dict()``) ou None.
    trade_plan: Mapping[str, Any] | None
    #: Saídas serializadas dos engines, para auditoria completa.
    assessments: Mapping[str, Any] = field(default_factory=dict)
    code_version: str = "0.0.0"
    ruleset_version: str = "0"
    config_hash: str = ""
    inputs_digest: str = ""
    #: Latência de avaliação, em milissegundos.
    eval_ms: float | None = None
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "as_of", ensure_utc(self.as_of))
        if self.decision is Decision.LIVE_ORDER:
            raise ContractViolation(
                "v1 não emite LIVE_ORDER: execução real não está implementada"
            )
        if self.decision is Decision.SHADOW_INTENT and self.trade_plan is None:
            raise ContractViolation("SHADOW_INTENT exige trade_plan")
        if self.decision is Decision.NO_TRADE and self.trade_plan is not None:
            raise ContractViolation("NO_TRADE não pode carregar trade_plan")

    @property
    def blocking_reasons(self) -> list[str]:
        out: list[str] = []
        for r in self.gates.results:
            if r.status in (GateStatus.FAIL, GateStatus.NOT_AVAILABLE):
                out.extend(f"{r.gate}: {reason}" for reason in r.reasons)
        return out

    def explain(self) -> str:
        """Explicação legível de uma linha por gate."""
        lines = [
            f"[{self.as_of.isoformat()}] {self.instrument} "
            f"mode={self.execution_mode} session={self.session_phase} "
            f"=> {self.decision}"
        ]
        for r in self.gates.results:
            mark = {
                GateStatus.PASS: "OK ",
                GateStatus.CONDITIONAL: "CND",
                GateStatus.FAIL: "FAIL",
                GateStatus.NOT_AVAILABLE: "N/A",
            }[r.status]
            proxy = " [proxy]" if r.uses_proxy else ""
            reason = f" — {'; '.join(r.reasons)}" if r.reasons else ""
            lines.append(f"  {mark} {r.gate}{proxy}{reason}")
        if self.gates.short_circuited_at:
            lines.append(f"  (curto-circuito em {self.gates.short_circuited_at})")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "as_of": self.as_of.isoformat(),
            "instrument": self.instrument,
            "execution_mode": str(self.execution_mode),
            "session_phase": str(self.session_phase),
            "decision": str(self.decision),
            "gates": self.gates.to_dict(),
            "trade_plan": dict(self.trade_plan) if self.trade_plan else None,
            "assessments": dict(self.assessments),
            "code_version": self.code_version,
            "ruleset_version": self.ruleset_version,
            "config_hash": self.config_hash,
            "inputs_digest": self.inputs_digest,
            "eval_ms": self.eval_ms,
            "warnings": list(self.warnings),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False)


def make_decision_id(as_of: datetime, instrument: str, inputs_digest: str) -> str:
    return "dec_" + digest_of([ensure_utc(as_of).isoformat(), instrument, inputs_digest])[:20]
