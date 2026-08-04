"""CLI do DeGold OS.

Comandos:

``validate-config``
    Carrega e valida a configuração, imprime o ``config_hash``. Falha com
    código 2 se a configuração for inválida — é o boot fail-closed.

``replay``
    Roda o orquestrador sobre arquivos CSV de barras, decidindo no fechamento
    de cada barra do timeframe de decisão, e imprime o resumo agregado.

``explain``
    Roda uma única avaliação em um instante e imprime a explicação por gate.

Nenhum comando envia ordem. Não existe comando ``live``.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Sequence

from ..adapters.macro_calendar import load_macro_events
from ..adapters.market_data import ReplaySource, load_bars_csv
from ..configuration.loader import load_config
from ..contracts.context import EvaluationContext
from ..domain.enums import ExecutionMode, Timeframe
from ..domain.errors import DeGoldError
from ..domain.market import BarSeries
from ..domain.timing import AsOf, ensure_utc
from ..orchestration.orchestrator import DecisionOrchestrator
from ..telemetry.metrics import aggregate
from ..telemetry.sinks import build_sink

__all__ = ["main"]


def _load_series(data_dir: Path, timeframes: Sequence[Timeframe], latency_ms: int):
    series: dict[Timeframe, BarSeries] = {}
    missing: list[str] = []
    for tf in timeframes:
        path = data_dir / f"{tf}.csv"
        if not path.exists():
            missing.append(str(path))
            continue
        series[tf] = load_bars_csv(path, tf, latency_ms)
    return series, missing


def _cmd_validate_config(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    print(json.dumps({"ok": True, "config_hash": cfg.config_hash,
                      "execution_mode": str(cfg.runtime.execution_mode),
                      "maturity_stage": str(cfg.maturity.stage),
                      "instrument": cfg.instrument.symbol}, indent=2, ensure_ascii=False))
    if cfg.runtime.execution_mode is ExecutionMode.LIVE:
        print("ERRO: execution_mode=LIVE não é suportado nesta versão.", file=sys.stderr)
        return 2
    return 0


def _build_context(cfg, source: ReplaySource, as_of: datetime, macro_path: str | None):
    snapshot = source.snapshot_at(as_of)
    return EvaluationContext(
        as_of=AsOf(as_of),
        snapshot=snapshot,
        config=cfg,
        macro_events=load_macro_events(macro_path),
        account=None,
        position=None,
        risk_ledger=None,
        meta={"source": "cli.replay"},
    )


def _cmd_replay(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    data_dir = Path(args.data_dir)
    series, missing = _load_series(
        data_dir, cfg.data_quality.required_timeframes, cfg.runtime.ingestion_latency_ms
    )
    if missing:
        print(f"AVISO: arquivos ausentes: {missing}", file=sys.stderr)
    if not series:
        print("ERRO: nenhum arquivo de barras encontrado.", file=sys.stderr)
        return 2

    source = ReplaySource(cfg.instrument, series)
    decision_tf = Timeframe(args.decision_timeframe)
    if decision_tf not in series:
        print(f"ERRO: timeframe de decisão {decision_tf} sem dados.", file=sys.stderr)
        return 2

    sink = build_sink(cfg.telemetry.sink, cfg.telemetry.path)
    orch = DecisionOrchestrator(telemetry=sink)

    records = []
    for as_of in source.decision_times(decision_tf):
        ctx = _build_context(cfg, source, as_of, args.macro)
        records.append(orch.evaluate(ctx))
        if args.limit and len(records) >= args.limit:
            break

    metrics = aggregate(records)
    print(json.dumps(metrics.to_dict(), indent=2, ensure_ascii=False))
    sink.flush()
    return 0


def _cmd_explain(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    data_dir = Path(args.data_dir)
    series, _ = _load_series(
        data_dir, cfg.data_quality.required_timeframes, cfg.runtime.ingestion_latency_ms
    )
    if not series:
        print("ERRO: nenhum arquivo de barras encontrado.", file=sys.stderr)
        return 2
    source = ReplaySource(cfg.instrument, series)
    as_of = ensure_utc(datetime.fromisoformat(args.at))
    ctx = _build_context(cfg, source, as_of, args.macro)
    record = DecisionOrchestrator().evaluate(ctx)
    print(record.explain())
    if args.json:
        print(json.dumps(record.to_dict(), indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="degold",
        description="DeGold OS — decisão causal, auditável, READ_ONLY/SHADOW. "
                    "Este programa não envia ordens.",
    )
    p.add_argument("--config", default=None, help="caminho do arquivo de configuração")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("validate-config", help="valida a configuração e imprime o hash")

    rep = sub.add_parser("replay", help="roda decisões sobre CSVs de barras")
    rep.add_argument("--data-dir", required=True, help="diretório com <TF>.csv")
    rep.add_argument("--decision-timeframe", default="M1")
    rep.add_argument("--macro", default=None, help="JSON de calendário macro")
    rep.add_argument("--limit", type=int, default=0)

    exp = sub.add_parser("explain", help="explica a decisão em um instante")
    exp.add_argument("--data-dir", required=True)
    exp.add_argument("--at", required=True, help="instante ISO-8601 com fuso")
    exp.add_argument("--macro", default=None)
    exp.add_argument("--json", action="store_true")

    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handlers = {
        "validate-config": _cmd_validate_config,
        "replay": _cmd_replay,
        "explain": _cmd_explain,
    }
    try:
        return handlers[args.command](args)
    except DeGoldError as exc:
        print(f"ERRO ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
