"""DeGold OS Bot — núcleo institucional de decisão.

Arquitetura: REGIME → LIQUIDITY → ACCEPTANCE → FLOW → EXECUTION,
instrumentada pelos gates G0..G9.

Esta versão é READ_ONLY/SHADOW por construção: não existe caminho de código
que envie uma ordem real. Ver ``docs/LIMITACOES.md`` antes de qualquer uso.
"""

from __future__ import annotations

__version__ = "0.1.0"
#: Versão do conjunto de regras. Muda sempre que o significado de um gate,
#: enum ou limiar muda — é o que torna DecisionRecords comparáveis entre si.
RULESET_VERSION = "2026.08.0"

__all__ = ["__version__", "RULESET_VERSION"]
