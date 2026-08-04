"""Registry de maturidade do setup — insumo do Gate G9.

O estágio **não** é inferido em runtime a partir de resultados recentes: isso
seria overfitting operacional disfarçado. Ele é declarado em configuração e só
muda por decisão humana, apoiada em evidência (relatório de backtest OOS,
relatório de walk-forward, relatório de shadow mode).

``historical_confidence`` é rejeitado pelo próprio modelo de domínio se OOS e
walk-forward não estiverem marcados como concluídos. Isto é uma trava de tipo,
não uma convenção.
"""

from __future__ import annotations

from ..contracts.context import EvaluationContext
from ..domain.assessments import MaturityAssessment

__all__ = ["ConfigEdgeMaturityRegistry"]


class ConfigEdgeMaturityRegistry:
    def assess(self, ctx: EvaluationContext) -> MaturityAssessment:
        cfg = ctx.config.maturity
        notes: list[str] = []
        if cfg.historical_confidence is None:
            notes.append(
                "historical_confidence indisponível: exige OOS + walk-forward "
                "concluídos e registrados"
            )
        if not cfg.oos_completed:
            notes.append("out-of-sample não concluído")
        if not cfg.walk_forward_completed:
            notes.append("walk-forward não concluído")
        if cfg.evidence_ref is None:
            notes.append("nenhuma referência de evidência registrada para o estágio")

        return MaturityAssessment(
            setup_id=cfg.setup_id,
            stage=cfg.stage,
            oos_completed=cfg.oos_completed,
            walk_forward_completed=cfg.walk_forward_completed,
            sample_size=cfg.sample_size,
            historical_confidence=cfg.historical_confidence,
            evidence_ref=cfg.evidence_ref,
            notes=tuple(notes),
        )
