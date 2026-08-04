"""Hierarquia de erros do DeGold OS.

Política fail-closed: qualquer erro não tratado durante uma avaliação deve
resultar em ``NO_TRADE``, nunca em decisão parcial. O orquestrador captura
``DeGoldError`` e a converte em gate ``FAIL`` com evidência do erro;
``CausalityViolation`` é deliberadamente **não** capturada em modo estrito,
porque indica bug de implementação e não condição de mercado.
"""

from __future__ import annotations

__all__ = [
    "DeGoldError",
    "CausalityViolation",
    "DataQualityError",
    "ConfigurationError",
    "ContractViolation",
    "ExecutionModeViolation",
    "MaturityViolation",
    "NotAvailableError",
]


class DeGoldError(Exception):
    """Base de todos os erros do sistema."""


class CausalityViolation(DeGoldError):
    """Uso de informação futura, timestamp inválido ou reescrita de histórico."""


class DataQualityError(DeGoldError):
    """Dado ausente, corrompido, fora de ordem ou obsoleto."""


class ConfigurationError(DeGoldError):
    """Configuração inválida, incompleta ou incoerente."""


class ContractViolation(DeGoldError):
    """Um engine retornou algo fora do contrato declarado."""


class ExecutionModeViolation(DeGoldError):
    """Tentativa de ação não permitida no modo de execução corrente.

    Exemplo: emitir ordem real com ``ExecutionMode.READ_ONLY``.
    """


class MaturityViolation(DeGoldError):
    """Tentativa de operar abaixo do estágio de maturidade exigido (G9)."""


class NotAvailableError(DeGoldError):
    """Recurso consultado não existe no instante ``as_of``.

    Nunca deve ser convertido em zero, vazio ou default silencioso pelo
    chamador: propague ou traduza em ``GateStatus.NOT_AVAILABLE``.
    """
