"""Enumerações canônicas do DeGold OS.

Regras de projeto:
- Nenhum enum possui valor "0 implícito" que signifique ausência de dado.
  Ausência é sempre representada por ``UNKNOWN``/``NOT_AVAILABLE`` explícito
  ou por ``None`` em campos ``Optional``.
- Os valores são strings estáveis: fazem parte do contrato serializado
  (telemetria, decision records, schemas JSON) e não podem ser renomeados
  sem bump de ``RULESET_VERSION``.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "GateStatus",
    "GateId",
    "Decision",
    "ExecutionMode",
    "EdgeMaturityStage",
    "Timeframe",
    "SessionPhase",
    "MarketRegime",
    "VolatilityRegime",
    "TrendDirection",
    "Side",
    "StructureEvent",
    "LiquidityPoolKind",
    "SweepOutcome",
    "AcceptanceVerdict",
    "FlowVerdict",
    "DataQualityStatus",
    "SourceKind",
    "Confidence",
    "PositionState",
    "OrderIntentKind",
    "OrderType",
    "TimeInForce",
    "RiskBreach",
]


class StrEnum(str, Enum):
    """Enum serializável como string pura em JSON."""

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


# ---------------------------------------------------------------------------
# Decisão e gates
# ---------------------------------------------------------------------------


class GateStatus(StrEnum):
    """Resultado possível de qualquer Decision Gate.

    NOT_AVAILABLE é distinto de FAIL: significa "não foi possível avaliar".
    A política fail-closed decide se NOT_AVAILABLE bloqueia (ver
    ``GatePolicy.treat_not_available_as``).
    """

    PASS = "PASS"
    CONDITIONAL = "CONDITIONAL"
    FAIL = "FAIL"
    NOT_AVAILABLE = "NOT_AVAILABLE"


class GateId(StrEnum):
    G0_DATA = "G0_DATA"
    G1_MACRO = "G1_MACRO"
    G2_REGIME = "G2_REGIME"
    G3_LIQUIDITY = "G3_LIQUIDITY"
    G4_INTERACTION = "G4_INTERACTION"
    G5_FLOW = "G5_FLOW"
    G6_EXECUTION = "G6_EXECUTION"
    G7_RISK = "G7_RISK"
    G8_POSITION = "G8_POSITION"
    G9_EDGE_MATURITY = "G9_EDGE_MATURITY"


#: Ordem canônica de avaliação. É também a ordem de curto-circuito.
GATE_ORDER: tuple[GateId, ...] = (
    GateId.G0_DATA,
    GateId.G1_MACRO,
    GateId.G2_REGIME,
    GateId.G3_LIQUIDITY,
    GateId.G4_INTERACTION,
    GateId.G5_FLOW,
    GateId.G6_EXECUTION,
    GateId.G7_RISK,
    GateId.G8_POSITION,
    GateId.G9_EDGE_MATURITY,
)


class Decision(StrEnum):
    """Saída terminal do Decision Orchestrator.

    ``LIVE_ORDER`` existe no enum apenas como alvo futuro; a v1 nunca a emite
    (ver ``ExecutionEngine`` e ``BrokerAdapter``, que recusam produzi-la).
    """

    NO_TRADE = "NO_TRADE"
    OBSERVE = "OBSERVE"
    SHADOW_INTENT = "SHADOW_INTENT"
    LIVE_ORDER = "LIVE_ORDER"


class ExecutionMode(StrEnum):
    READ_ONLY = "READ_ONLY"
    SHADOW = "SHADOW"
    LIVE = "LIVE"


class EdgeMaturityStage(StrEnum):
    """Escada de maturidade do setup (Gate G9).

    A ordem é estritamente crescente e é usada para comparação — ver
    ``MATURITY_ORDER``. Nenhum estágio abaixo de ``SHADOW_MODE`` autoriza
    emissão de ordem, nem simulada com efeito externo.
    """

    RESEARCH = "RESEARCH"
    BACKTEST_IN_SAMPLE = "BACKTEST_IN_SAMPLE"
    BACKTEST_OUT_OF_SAMPLE = "BACKTEST_OUT_OF_SAMPLE"
    WALK_FORWARD_VALIDATED = "WALK_FORWARD_VALIDATED"
    SHADOW_MODE = "SHADOW_MODE"
    LIVE_PILOT = "LIVE_PILOT"
    LIVE_FULL = "LIVE_FULL"


MATURITY_ORDER: tuple[EdgeMaturityStage, ...] = (
    EdgeMaturityStage.RESEARCH,
    EdgeMaturityStage.BACKTEST_IN_SAMPLE,
    EdgeMaturityStage.BACKTEST_OUT_OF_SAMPLE,
    EdgeMaturityStage.WALK_FORWARD_VALIDATED,
    EdgeMaturityStage.SHADOW_MODE,
    EdgeMaturityStage.LIVE_PILOT,
    EdgeMaturityStage.LIVE_FULL,
)


def maturity_rank(stage: EdgeMaturityStage) -> int:
    """Posição ordinal do estágio na escada de maturidade."""
    return MATURITY_ORDER.index(stage)


# ---------------------------------------------------------------------------
# Tempo e sessão
# ---------------------------------------------------------------------------


class Timeframe(StrEnum):
    H4 = "H4"
    M15 = "M15"
    M5 = "M5"
    M2 = "M2"
    M1 = "M1"


TIMEFRAME_SECONDS: dict[Timeframe, int] = {
    Timeframe.H4: 4 * 60 * 60,
    Timeframe.M15: 15 * 60,
    Timeframe.M5: 5 * 60,
    Timeframe.M2: 2 * 60,
    Timeframe.M1: 60,
}


class SessionPhase(StrEnum):
    """Fases relevantes ao MVP. Fases não modeladas caem em ``OUT_OF_SCOPE``."""

    ASIA = "ASIA"
    LONDON = "LONDON"
    PRE_NY = "PRE_NY"
    NY_OPEN = "NY_OPEN"
    NY_MIDDAY = "NY_MIDDAY"
    NY_CLOSE = "NY_CLOSE"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"
    MARKET_CLOSED = "MARKET_CLOSED"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Regime e estrutura
# ---------------------------------------------------------------------------


class MarketRegime(StrEnum):
    TREND_UP = "TREND_UP"
    TREND_DOWN = "TREND_DOWN"
    BALANCE = "BALANCE"
    EXPANSION = "EXPANSION"
    UNKNOWN = "UNKNOWN"


class VolatilityRegime(StrEnum):
    COMPRESSED = "COMPRESSED"
    NORMAL = "NORMAL"
    ELEVATED = "ELEVATED"
    EXTREME = "EXTREME"
    UNKNOWN = "UNKNOWN"


class TrendDirection(StrEnum):
    UP = "UP"
    DOWN = "DOWN"
    SIDEWAYS = "SIDEWAYS"
    UNKNOWN = "UNKNOWN"


class Side(StrEnum):
    LONG = "LONG"
    SHORT = "SHORT"


class StructureEvent(StrEnum):
    BOS_UP = "BOS_UP"
    BOS_DOWN = "BOS_DOWN"
    CHOCH_UP = "CHOCH_UP"
    CHOCH_DOWN = "CHOCH_DOWN"
    NONE = "NONE"


# ---------------------------------------------------------------------------
# Liquidez / aceitação / fluxo
# ---------------------------------------------------------------------------


class LiquidityPoolKind(StrEnum):
    PREV_DAY_HIGH = "PREV_DAY_HIGH"
    PREV_DAY_LOW = "PREV_DAY_LOW"
    SESSION_HIGH = "SESSION_HIGH"
    SESSION_LOW = "SESSION_LOW"
    EQUAL_HIGHS = "EQUAL_HIGHS"
    EQUAL_LOWS = "EQUAL_LOWS"
    SWING_HIGH = "SWING_HIGH"
    SWING_LOW = "SWING_LOW"


class SweepOutcome(StrEnum):
    """Resultado de uma interação com um pool de liquidez.

    ``PENDING`` é o estado enquanto a barra de confirmação ainda não fechou —
    nunca é promovido a evento confirmado.
    """

    PENDING = "PENDING"
    REJECTED = "REJECTED"
    ACCEPTED_THROUGH = "ACCEPTED_THROUGH"
    NO_INTERACTION = "NO_INTERACTION"


class AcceptanceVerdict(StrEnum):
    REJECTION = "REJECTION"
    ACCEPTANCE = "ACCEPTANCE"
    INDECISION = "INDECISION"
    NOT_AVAILABLE = "NOT_AVAILABLE"


class FlowVerdict(StrEnum):
    SUPPORTIVE = "SUPPORTIVE"
    NEUTRAL = "NEUTRAL"
    OPPOSED = "OPPOSED"
    NOT_AVAILABLE = "NOT_AVAILABLE"


# ---------------------------------------------------------------------------
# Qualidade de dado e proveniência
# ---------------------------------------------------------------------------


class DataQualityStatus(StrEnum):
    OK = "OK"
    DEGRADED = "DEGRADED"
    UNUSABLE = "UNUSABLE"
    NOT_AVAILABLE = "NOT_AVAILABLE"


class SourceKind(StrEnum):
    """Proveniência de qualquer medida.

    ``PROXY`` obriga rotulagem explícita em ``Measurement.proxy_for`` e
    limita o gate correspondente a, no máximo, ``CONDITIONAL``.
    """

    DIRECT = "DIRECT"
    DERIVED = "DERIVED"
    PROXY = "PROXY"
    SYNTHETIC = "SYNTHETIC"


class Confidence(StrEnum):
    """Confiança estrutural (qualidade do sinal), nunca probabilidade de acerto.

    Probabilidade histórica só existe em ``HistoricalConfidence`` e apenas
    após OOS + walk-forward (ver ``degold_os.domain.decision``).
    """

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Posição e execução
# ---------------------------------------------------------------------------


class PositionState(StrEnum):
    FLAT = "FLAT"
    PENDING_ENTRY = "PENDING_ENTRY"
    OPEN = "OPEN"
    SCALING_OUT = "SCALING_OUT"
    PENDING_EXIT = "PENDING_EXIT"
    BLOCKED = "BLOCKED"


class OrderIntentKind(StrEnum):
    ENTRY = "ENTRY"
    STOP_LOSS = "STOP_LOSS"
    TAKE_PROFIT = "TAKE_PROFIT"
    FLATTEN = "FLATTEN"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"


class TimeInForce(StrEnum):
    DAY = "DAY"
    GTC = "GTC"
    IOC = "IOC"


class RiskBreach(StrEnum):
    DAILY_LOSS_LIMIT = "DAILY_LOSS_LIMIT"
    MAX_TRADES_PER_SESSION = "MAX_TRADES_PER_SESSION"
    MAX_CONSECUTIVE_LOSSES = "MAX_CONSECUTIVE_LOSSES"
    PER_TRADE_RISK_EXCEEDED = "PER_TRADE_RISK_EXCEEDED"
    RISK_STATE_UNKNOWN = "RISK_STATE_UNKNOWN"
    OUTSIDE_RISK_WINDOW = "OUTSIDE_RISK_WINDOW"
    ACCOUNT_STATE_STALE = "ACCOUNT_STATE_STALE"
