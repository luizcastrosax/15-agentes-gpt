"""Métricas operacionais agregadas a partir de ``DecisionRecord``.

Importante: estas são métricas de **processo**, não de performance financeira.
Elas respondem "o sistema está funcionando e por onde ele barra?", nunca
"o sistema é lucrativo?". Métrica de resultado só existe depois de backtest
OOS e walk-forward, e vive em relatórios separados.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

from ..domain.decision import DecisionRecord
from ..domain.enums import Decision, GateStatus

__all__ = ["DecisionMetrics", "aggregate"]


@dataclass(slots=True)
class DecisionMetrics:
    total: int = 0
    by_decision: Counter[str] = field(default_factory=Counter)
    #: Onde o pipeline parou (gate de curto-circuito).
    blocked_at: Counter[str] = field(default_factory=Counter)
    #: Contagem de status por gate.
    gate_status: dict[str, Counter[str]] = field(default_factory=dict)
    proxy_decisions: int = 0
    latency_ms_sum: float = 0.0
    latency_ms_max: float = 0.0

    @property
    def latency_ms_avg(self) -> float | None:
        return self.latency_ms_sum / self.total if self.total else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "by_decision": dict(self.by_decision),
            "blocked_at": dict(self.blocked_at),
            "gate_status": {g: dict(c) for g, c in self.gate_status.items()},
            "proxy_decisions": self.proxy_decisions,
            "latency_ms_avg": self.latency_ms_avg,
            "latency_ms_max": self.latency_ms_max,
        }


def aggregate(records: Iterable[DecisionRecord]) -> DecisionMetrics:
    m = DecisionMetrics()
    for rec in records:
        m.total += 1
        m.by_decision[str(rec.decision)] += 1
        if rec.gates.short_circuited_at:
            m.blocked_at[str(rec.gates.short_circuited_at)] += 1
        elif rec.decision is Decision.NO_TRADE:
            m.blocked_at["AGGREGATION"] += 1
        for r in rec.gates.results:
            m.gate_status.setdefault(str(r.gate), Counter())[str(r.status)] += 1
        if rec.gates.uses_proxy:
            m.proxy_decisions += 1
        if rec.eval_ms is not None:
            m.latency_ms_sum += rec.eval_ms
            m.latency_ms_max = max(m.latency_ms_max, rec.eval_ms)
    return m


#: Status considerados "saudáveis" ao inspecionar um dia de shadow mode.
HEALTHY_STATUSES = (GateStatus.PASS, GateStatus.CONDITIONAL)
