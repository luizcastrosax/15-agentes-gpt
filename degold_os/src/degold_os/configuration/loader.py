"""Carregamento e validação de configuração.

Formatos aceitos: JSON e YAML (YAML só se ``pyyaml`` estiver instalado).
O arquivo de instrumento é carregado separadamente e referenciado por
``instrument_ref``, para que a mesma estratégia possa rodar em outro contrato
sem duplicar parâmetros de risco.

Fail-closed: qualquer chave obrigatória ausente aborta o boot com
``ConfigurationError``. Não há "config parcial".
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from ..domain.errors import ConfigurationError
from ..domain.market import Instrument
from .models import (
    AcceptanceConfig,
    DataQualityConfig,
    DeGoldConfig,
    ExecutionConfig,
    FlowConfig,
    GatePolicy,
    LiquidityConfig,
    MacroConfig,
    MaturityConfig,
    RegimeConfig,
    RiskConfig,
    RuntimeConfig,
    SessionConfig,
    StructureConfig,
    TelemetryConfig,
)

__all__ = ["load_config", "load_config_dict", "build_config", "DEFAULT_CONFIG_PATH"]

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "degold.mnq.json"


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigurationError(f"arquivo de configuração não encontrado: {path}")
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        try:
            import yaml  # type: ignore[import-untyped]
        except ImportError as exc:  # pragma: no cover - ambiente sem pyyaml
            raise ConfigurationError(
                "config YAML requer pyyaml instalado; use JSON ou instale pyyaml"
            ) from exc
        data = yaml.safe_load(text)
    else:
        data = json.loads(text)
    if not isinstance(data, dict):
        raise ConfigurationError(f"config raiz deve ser objeto/dict: {path}")
    return data


def load_instrument(path: Path) -> Instrument:
    d = _read(path)
    missing = {"symbol", "tick_size", "point_value"} - set(d)
    if missing:
        raise ConfigurationError(f"instrumento {path}: faltam campos {sorted(missing)}")
    return Instrument(
        symbol=str(d["symbol"]),
        tick_size=float(d["tick_size"]),
        point_value=float(d["point_value"]),
        currency=str(d.get("currency", "USD")),
        exchange=str(d.get("exchange", "")),
        description=str(d.get("description", "")),
    )


def build_config(raw: Mapping[str, Any], base_dir: Path | None = None) -> DeGoldConfig:
    """Constrói e valida a configuração a partir de um dict já lido."""
    for section in (
        "runtime",
        "session",
        "data_quality",
        "macro",
        "regime",
        "structure",
        "liquidity",
        "acceptance",
        "flow",
        "execution",
        "risk",
        "gates",
        "maturity",
        "telemetry",
    ):
        if section not in raw:
            raise ConfigurationError(f"seção obrigatória ausente: config.{section}")

    if "instrument" in raw and isinstance(raw["instrument"], Mapping):
        idict = raw["instrument"]
        instrument = Instrument(
            symbol=str(idict["symbol"]),
            tick_size=float(idict["tick_size"]),
            point_value=float(idict["point_value"]),
            currency=str(idict.get("currency", "USD")),
            exchange=str(idict.get("exchange", "")),
            description=str(idict.get("description", "")),
        )
    elif "instrument_ref" in raw:
        ref = Path(str(raw["instrument_ref"]))
        if not ref.is_absolute():
            root = base_dir or DEFAULT_CONFIG_PATH.parent
            ref = (root / ref).resolve()
        instrument = load_instrument(ref)
    else:
        raise ConfigurationError("config exige 'instrument' ou 'instrument_ref'")

    cfg = DeGoldConfig(
        runtime=RuntimeConfig.from_dict(raw["runtime"]),
        instrument=instrument,
        session=SessionConfig.from_dict(raw["session"]),
        data_quality=DataQualityConfig.from_dict(raw["data_quality"]),
        macro=MacroConfig.from_dict(raw["macro"]),
        regime=RegimeConfig.from_dict(raw["regime"]),
        structure=StructureConfig.from_dict(raw["structure"]),
        liquidity=LiquidityConfig.from_dict(raw["liquidity"]),
        acceptance=AcceptanceConfig.from_dict(raw["acceptance"]),
        flow=FlowConfig.from_dict(raw["flow"]),
        execution=ExecutionConfig.from_dict(raw["execution"]),
        risk=RiskConfig.from_dict(raw["risk"]),
        gates=GatePolicy.from_dict(raw["gates"]),
        maturity=MaturityConfig.from_dict(raw["maturity"]),
        telemetry=TelemetryConfig.from_dict(raw["telemetry"]),
        raw=dict(raw),
    )
    _cross_validate(cfg)
    return cfg


def _cross_validate(cfg: DeGoldConfig) -> None:
    """Coerências entre seções — o lugar onde erros silenciosos morrem."""
    required = set(cfg.data_quality.required_timeframes)
    needed = {
        cfg.regime.htf,
        cfg.regime.mtf,
        cfg.structure.timeframe,
        cfg.liquidity.detection_timeframe,
        cfg.liquidity.pool_timeframe,
        cfg.acceptance.timeframe,
        cfg.flow.timeframe,
        cfg.execution.entry_timeframe,
    }
    absent = needed - required
    if absent:
        raise ConfigurationError(
            "timeframes usados pelos engines devem constar em "
            f"data_quality.required_timeframes: faltam {sorted(str(t) for t in absent)}"
        )
    for tf in required:
        if str(tf) not in cfg.data_quality.min_bars:
            raise ConfigurationError(f"data_quality.min_bars não define {tf}")
    if cfg.maturity.historical_confidence is not None and not (
        cfg.maturity.oos_completed and cfg.maturity.walk_forward_completed
    ):
        raise ConfigurationError(
            "maturity.historical_confidence exige oos_completed e walk_forward_completed"
        )


def load_config_dict(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    return _read(p)


def load_config(path: str | Path | None = None) -> DeGoldConfig:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    return build_config(_read(p), base_dir=p.parent)
