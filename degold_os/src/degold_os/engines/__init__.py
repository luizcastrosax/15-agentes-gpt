"""Implementações baseline dos engines.

"Baseline" significa: correta em relação ao contrato, causal, auditável e
deliberadamente simples. Não significa otimizada nem validada estatisticamente.
Nenhuma delas tem edge comprovado — ver ``docs/LIMITACOES.md``.
"""

from .acceptance import BaselineAcceptanceEngine  # noqa: F401
from .data_quality import BaselineDataQualityEngine  # noqa: F401
from .execution import BaselineExecutionEngine  # noqa: F401
from .flow import BaselineFlowEngine  # noqa: F401
from .liquidity import BaselineLiquidityEngine  # noqa: F401
from .macro import BaselineMacroEngine  # noqa: F401
from .maturity import ConfigEdgeMaturityRegistry  # noqa: F401
from .position_router import BaselinePositionStateRouter  # noqa: F401
from .regime import BaselineRegimeEngine  # noqa: F401
from .risk import BaselineRiskEngine  # noqa: F401
from .session import BaselineSessionEngine  # noqa: F401
from .structure import BaselineStructureEngine  # noqa: F401
