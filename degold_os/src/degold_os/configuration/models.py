"""Modelos de configuração.

Princípios:

- **Sem defaults silenciosos em parâmetros de risco.** Campos que afetam risco
  ou execução não têm default permissivo; se faltarem, ``ConfigurationError``.
- Toda configuração é congelada (``frozen=True``) e hasheável: o
  ``config_hash`` entra em cada ``DecisionRecord``.
- ``ExecutionMode`` é validado contra a maturidade em ``G9``; configurar
  ``LIVE`` não habilita execução real em v1 — o broker adapter recusa.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

from ..domain.decision import digest_of
from ..domain.enums import EdgeMaturityStage, ExecutionMode, GateStatus, Timeframe
from ..domain.errors import ConfigurationError
from ..domain.market import Instrument

__all__ = [
    "RuntimeConfig",
    "SessionWindow",
    "SessionConfig",
    "DataQualityConfig",
    "MacroConfig",
    "RegimeConfig",
    "StructureConfig",
    "LiquidityConfig",
    "AcceptanceConfig",
    "FlowConfig",
    "ExecutionConfig",
    "RiskConfig",
    "GatePolicy",
    "MaturityConfig",
    "TelemetryConfig",
    "DeGoldConfig",
]


def _require(d: Mapping[str, Any], key: str, section: str) -> Any:
    if key not in d:
        raise ConfigurationError(f"config.{section}.{key} é obrigatório e está ausente")
    return d[key]


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    execution_mode: ExecutionMode
    code_version: str
    ruleset_version: str
    #: Latência assumida entre o close da barra e sua disponibilidade (ms).
    ingestion_latency_ms: int

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> RuntimeConfig:
        mode = ExecutionMode(_require(d, "execution_mode", "runtime"))
        return RuntimeConfig(
            execution_mode=mode,
            code_version=str(_require(d, "code_version", "runtime")),
            ruleset_version=str(_require(d, "ruleset_version", "runtime")),
            ingestion_latency_ms=int(_require(d, "ingestion_latency_ms", "runtime")),
        )


@dataclass(frozen=True, slots=True)
class SessionWindow:
    """Janela de sessão em hora local do fuso configurado (HH:MM, fim exclusivo)."""

    name: str
    start: str
    end: str
    tradable: bool

    @property
    def start_minutes(self) -> int:
        return _hhmm(self.start, f"session.{self.name}.start")

    @property
    def end_minutes(self) -> int:
        return _hhmm(self.end, f"session.{self.name}.end")


def _hhmm(value: str, where: str) -> int:
    try:
        h, m = value.split(":")
        hh, mm = int(h), int(m)
    except Exception as exc:  # noqa: BLE001
        raise ConfigurationError(f"{where}: formato HH:MM inválido ({value!r})") from exc
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        raise ConfigurationError(f"{where}: hora fora do intervalo ({value!r})")
    return hh * 60 + mm


@dataclass(frozen=True, slots=True)
class SessionConfig:
    timezone: str
    windows: tuple[SessionWindow, ...]
    #: Dias da semana negociáveis (0=segunda ... 6=domingo).
    trading_weekdays: tuple[int, ...]

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> SessionConfig:
        raw = _require(d, "windows", "session")
        windows = tuple(
            SessionWindow(
                name=str(w["name"]),
                start=str(w["start"]),
                end=str(w["end"]),
                tradable=bool(w["tradable"]),
            )
            for w in raw
        )
        if not windows:
            raise ConfigurationError("config.session.windows não pode ser vazio")
        for w in windows:  # valida formato cedo
            w.start_minutes, w.end_minutes  # noqa: B018
        return SessionConfig(
            timezone=str(_require(d, "timezone", "session")),
            windows=windows,
            trading_weekdays=tuple(int(x) for x in _require(d, "trading_weekdays", "session")),
        )


@dataclass(frozen=True, slots=True)
class DataQualityConfig:
    #: Mínimo de barras confirmadas por timeframe para o TF ser utilizável.
    min_bars: Mapping[str, int]
    #: Múltiplo da duração do TF acima do qual a série é considerada obsoleta.
    max_staleness_multiple: float
    #: Idade máxima da última mensagem do feed, em segundos.
    max_feed_staleness_seconds: float
    #: Timeframes sem os quais nenhuma decisão é possível.
    required_timeframes: tuple[Timeframe, ...]

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> DataQualityConfig:
        return DataQualityConfig(
            min_bars={str(k): int(v) for k, v in _require(d, "min_bars", "data_quality").items()},
            max_staleness_multiple=float(_require(d, "max_staleness_multiple", "data_quality")),
            max_feed_staleness_seconds=float(
                _require(d, "max_feed_staleness_seconds", "data_quality")
            ),
            required_timeframes=tuple(
                Timeframe(t) for t in _require(d, "required_timeframes", "data_quality")
            ),
        )


@dataclass(frozen=True, slots=True)
class MacroConfig:
    #: Se True, calendário ausente ⇒ G1 NOT_AVAILABLE (bloqueia por política).
    require_calendar: bool
    blackout_before_seconds: int
    blackout_after_seconds: int
    blocking_impacts: tuple[str, ...]

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> MacroConfig:
        return MacroConfig(
            require_calendar=bool(_require(d, "require_calendar", "macro")),
            blackout_before_seconds=int(_require(d, "blackout_before_seconds", "macro")),
            blackout_after_seconds=int(_require(d, "blackout_after_seconds", "macro")),
            blocking_impacts=tuple(str(x) for x in _require(d, "blocking_impacts", "macro")),
        )


@dataclass(frozen=True, slots=True)
class RegimeConfig:
    htf: Timeframe
    mtf: Timeframe
    atr_period: int
    atr_percentile_lookback: int
    ema_fast: int
    ema_slow: int
    #: Percentis que separam COMPRESSED / NORMAL / ELEVATED / EXTREME.
    vol_percentile_bounds: tuple[float, float, float]
    allowed_regimes: tuple[str, ...]

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> RegimeConfig:
        bounds = tuple(float(x) for x in _require(d, "vol_percentile_bounds", "regime"))
        if len(bounds) != 3 or not (0 < bounds[0] < bounds[1] < bounds[2] < 1):
            raise ConfigurationError(
                "config.regime.vol_percentile_bounds deve ter 3 valores crescentes em (0,1)"
            )
        return RegimeConfig(
            htf=Timeframe(_require(d, "htf", "regime")),
            mtf=Timeframe(_require(d, "mtf", "regime")),
            atr_period=int(_require(d, "atr_period", "regime")),
            atr_percentile_lookback=int(_require(d, "atr_percentile_lookback", "regime")),
            ema_fast=int(_require(d, "ema_fast", "regime")),
            ema_slow=int(_require(d, "ema_slow", "regime")),
            vol_percentile_bounds=(bounds[0], bounds[1], bounds[2]),
            allowed_regimes=tuple(str(x) for x in _require(d, "allowed_regimes", "regime")),
        )


@dataclass(frozen=True, slots=True)
class StructureConfig:
    timeframe: Timeframe
    swing_lookback: int
    min_break_ticks: float

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> StructureConfig:
        return StructureConfig(
            timeframe=Timeframe(_require(d, "timeframe", "structure")),
            swing_lookback=int(_require(d, "swing_lookback", "structure")),
            min_break_ticks=float(_require(d, "min_break_ticks", "structure")),
        )


@dataclass(frozen=True, slots=True)
class LiquidityConfig:
    detection_timeframe: Timeframe
    pool_timeframe: Timeframe
    swing_lookback: int
    equal_level_tolerance_ticks: float
    min_penetration_ticks: float
    max_penetration_ticks: float
    #: Barras de confirmação após a penetração (fechamento obrigatório).
    confirmation_bars: int
    #: Validade do sweep confirmado, em barras do TF de detecção.
    sweep_validity_bars: int
    #: Quantos pools de cada lado considerar.
    max_pools_per_side: int

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> LiquidityConfig:
        cfg = LiquidityConfig(
            detection_timeframe=Timeframe(_require(d, "detection_timeframe", "liquidity")),
            pool_timeframe=Timeframe(_require(d, "pool_timeframe", "liquidity")),
            swing_lookback=int(_require(d, "swing_lookback", "liquidity")),
            equal_level_tolerance_ticks=float(
                _require(d, "equal_level_tolerance_ticks", "liquidity")
            ),
            min_penetration_ticks=float(_require(d, "min_penetration_ticks", "liquidity")),
            max_penetration_ticks=float(_require(d, "max_penetration_ticks", "liquidity")),
            confirmation_bars=int(_require(d, "confirmation_bars", "liquidity")),
            sweep_validity_bars=int(_require(d, "sweep_validity_bars", "liquidity")),
            max_pools_per_side=int(_require(d, "max_pools_per_side", "liquidity")),
        )
        if cfg.confirmation_bars < 1:
            raise ConfigurationError("config.liquidity.confirmation_bars deve ser >= 1")
        if cfg.min_penetration_ticks <= 0:
            raise ConfigurationError("config.liquidity.min_penetration_ticks deve ser > 0")
        if cfg.max_penetration_ticks <= cfg.min_penetration_ticks:
            raise ConfigurationError(
                "config.liquidity.max_penetration_ticks deve ser > min_penetration_ticks"
            )
        return cfg


@dataclass(frozen=True, slots=True)
class AcceptanceConfig:
    timeframe: Timeframe
    #: Nº de barras avaliadas após o sweep para medir aceitação/rejeição.
    evaluation_bars: int
    #: Fração máxima de barras aceitas além do nível para configurar REJECTION.
    max_time_beyond_ratio: float
    #: Pavio de rejeição mínimo, como fração do range da barra.
    min_rejection_wick_ratio: float

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> AcceptanceConfig:
        return AcceptanceConfig(
            timeframe=Timeframe(_require(d, "timeframe", "acceptance")),
            evaluation_bars=int(_require(d, "evaluation_bars", "acceptance")),
            max_time_beyond_ratio=float(_require(d, "max_time_beyond_ratio", "acceptance")),
            min_rejection_wick_ratio=float(
                _require(d, "min_rejection_wick_ratio", "acceptance")
            ),
        )


@dataclass(frozen=True, slots=True)
class FlowConfig:
    timeframe: Timeframe
    lookback_bars: int
    #: Volume da barra de rejeição / média, mínimo para considerar SUPPORTIVE.
    min_volume_ratio: float
    #: Se False, ausência de fluxo real (tick/book) ⇒ G5 NOT_AVAILABLE.
    allow_proxy: bool

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> FlowConfig:
        return FlowConfig(
            timeframe=Timeframe(_require(d, "timeframe", "flow")),
            lookback_bars=int(_require(d, "lookback_bars", "flow")),
            min_volume_ratio=float(_require(d, "min_volume_ratio", "flow")),
            allow_proxy=bool(_require(d, "allow_proxy", "flow")),
        )


@dataclass(frozen=True, slots=True)
class ExecutionConfig:
    entry_timeframe: Timeframe
    #: Offset do preço de entrada em ticks a partir do gatilho.
    entry_offset_ticks: float
    #: Folga do stop além do extremo do sweep, em ticks.
    stop_buffer_ticks: float
    #: Stop mínimo e máximo em ticks (sanidade e proteção contra ruído).
    min_stop_ticks: float
    max_stop_ticks: float
    target_r_multiple: float
    min_rr_net: float
    #: Slippage assumido por perna, em ticks. É premissa, não medição.
    assumed_slippage_ticks: float
    #: Spread assumido quando não há cotação bid/ask (proxy declarado).
    assumed_spread_ticks: float
    #: Validade da ordem de entrada, em barras do TF de entrada.
    validity_bars: int

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> ExecutionConfig:
        cfg = ExecutionConfig(
            entry_timeframe=Timeframe(_require(d, "entry_timeframe", "execution")),
            entry_offset_ticks=float(_require(d, "entry_offset_ticks", "execution")),
            stop_buffer_ticks=float(_require(d, "stop_buffer_ticks", "execution")),
            min_stop_ticks=float(_require(d, "min_stop_ticks", "execution")),
            max_stop_ticks=float(_require(d, "max_stop_ticks", "execution")),
            target_r_multiple=float(_require(d, "target_r_multiple", "execution")),
            min_rr_net=float(_require(d, "min_rr_net", "execution")),
            assumed_slippage_ticks=float(_require(d, "assumed_slippage_ticks", "execution")),
            assumed_spread_ticks=float(_require(d, "assumed_spread_ticks", "execution")),
            validity_bars=int(_require(d, "validity_bars", "execution")),
        )
        if cfg.min_stop_ticks <= 0 or cfg.max_stop_ticks <= cfg.min_stop_ticks:
            raise ConfigurationError("config.execution: stops inválidos")
        if cfg.target_r_multiple <= 0:
            raise ConfigurationError("config.execution.target_r_multiple deve ser > 0")
        return cfg


@dataclass(frozen=True, slots=True)
class RiskConfig:
    max_risk_pct_per_trade: float
    daily_loss_limit_pct: float
    max_trades_per_session: int
    max_consecutive_losses: int
    max_contracts: int
    #: Se True, estado de conta/ledger desconhecido bloqueia (fail-closed).
    block_on_unknown_state: bool

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> RiskConfig:
        cfg = RiskConfig(
            max_risk_pct_per_trade=float(_require(d, "max_risk_pct_per_trade", "risk")),
            daily_loss_limit_pct=float(_require(d, "daily_loss_limit_pct", "risk")),
            max_trades_per_session=int(_require(d, "max_trades_per_session", "risk")),
            max_consecutive_losses=int(_require(d, "max_consecutive_losses", "risk")),
            max_contracts=int(_require(d, "max_contracts", "risk")),
            block_on_unknown_state=bool(_require(d, "block_on_unknown_state", "risk")),
        )
        if not 0 < cfg.max_risk_pct_per_trade <= 5:
            raise ConfigurationError(
                "config.risk.max_risk_pct_per_trade deve estar em (0, 5]"
            )
        if cfg.max_contracts < 1:
            raise ConfigurationError("config.risk.max_contracts deve ser >= 1")
        return cfg


@dataclass(frozen=True, slots=True)
class GatePolicy:
    """Como o orquestrador trata status não-PASS.

    ``treat_not_available_as`` existe para tornar a política fail-closed
    *explícita e auditável*, em vez de implícita no código.
    """

    treat_not_available_as: GateStatus
    #: Gates cujo FAIL não interrompe a avaliação (nunca inclui G0/G7/G9).
    non_critical_gates: tuple[str, ...]
    #: Nº máximo de gates CONDITIONAL tolerados antes de virar NO_TRADE.
    max_conditional_gates: int

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> GatePolicy:
        status = GateStatus(_require(d, "treat_not_available_as", "gates"))
        if status is GateStatus.PASS:
            raise ConfigurationError(
                "config.gates.treat_not_available_as=PASS viola a política fail-closed"
            )
        forbidden = {"G0_DATA", "G7_RISK", "G8_POSITION", "G9_EDGE_MATURITY"}
        non_critical = tuple(str(x) for x in d.get("non_critical_gates", ()))
        bad = forbidden.intersection(non_critical)
        if bad:
            raise ConfigurationError(
                f"gates críticos não podem ser marcados como não-críticos: {sorted(bad)}"
            )
        return GatePolicy(
            treat_not_available_as=status,
            non_critical_gates=non_critical,
            max_conditional_gates=int(_require(d, "max_conditional_gates", "gates")),
        )


@dataclass(frozen=True, slots=True)
class MaturityConfig:
    setup_id: str
    stage: EdgeMaturityStage
    oos_completed: bool
    walk_forward_completed: bool
    sample_size: int | None
    historical_confidence: float | None
    evidence_ref: str | None
    #: Estágio mínimo para emitir SHADOW_INTENT.
    min_stage_for_shadow: EdgeMaturityStage

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> MaturityConfig:
        return MaturityConfig(
            setup_id=str(_require(d, "setup_id", "maturity")),
            stage=EdgeMaturityStage(_require(d, "stage", "maturity")),
            oos_completed=bool(_require(d, "oos_completed", "maturity")),
            walk_forward_completed=bool(_require(d, "walk_forward_completed", "maturity")),
            sample_size=(None if d.get("sample_size") is None else int(d["sample_size"])),
            historical_confidence=(
                None
                if d.get("historical_confidence") is None
                else float(d["historical_confidence"])
            ),
            evidence_ref=(None if d.get("evidence_ref") is None else str(d["evidence_ref"])),
            min_stage_for_shadow=EdgeMaturityStage(
                _require(d, "min_stage_for_shadow", "maturity")
            ),
        )


@dataclass(frozen=True, slots=True)
class TelemetryConfig:
    enabled: bool
    sink: str  # "stdout" | "jsonl" | "null"
    path: str | None
    log_all_decisions: bool

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> TelemetryConfig:
        return TelemetryConfig(
            enabled=bool(_require(d, "enabled", "telemetry")),
            sink=str(_require(d, "sink", "telemetry")),
            path=(None if d.get("path") is None else str(d["path"])),
            log_all_decisions=bool(_require(d, "log_all_decisions", "telemetry")),
        )


@dataclass(frozen=True, slots=True)
class DeGoldConfig:
    runtime: RuntimeConfig
    instrument: Instrument
    session: SessionConfig
    data_quality: DataQualityConfig
    macro: MacroConfig
    regime: RegimeConfig
    structure: StructureConfig
    liquidity: LiquidityConfig
    acceptance: AcceptanceConfig
    flow: FlowConfig
    execution: ExecutionConfig
    risk: RiskConfig
    gates: GatePolicy
    maturity: MaturityConfig
    telemetry: TelemetryConfig
    raw: Mapping[str, Any] = field(default_factory=dict, compare=False)

    @property
    def config_hash(self) -> str:
        return digest_of(self.raw)

    def to_dict(self) -> dict[str, Any]:
        return {
            "runtime": asdict(self.runtime),
            "instrument": asdict(self.instrument),
            "session": asdict(self.session),
            "data_quality": asdict(self.data_quality),
            "macro": asdict(self.macro),
            "regime": asdict(self.regime),
            "structure": asdict(self.structure),
            "liquidity": asdict(self.liquidity),
            "acceptance": asdict(self.acceptance),
            "flow": asdict(self.flow),
            "execution": asdict(self.execution),
            "risk": asdict(self.risk),
            "gates": asdict(self.gates),
            "maturity": asdict(self.maturity),
            "telemetry": asdict(self.telemetry),
            "config_hash": self.config_hash,
        }
