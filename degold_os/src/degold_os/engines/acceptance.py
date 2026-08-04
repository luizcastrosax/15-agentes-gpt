"""7. Acceptance Engine (G4).

Responde a uma pergunta única e bem definida: **depois do sweep, o mercado
rejeitou o nível ou aceitou além dele?**

Método baseline, sobre barras fechadas do timeframe de aceitação (M1 no MVP),
avaliando as ``evaluation_bars`` barras posteriores à confirmação do sweep:

- ``time_beyond_ratio`` = fração de barras cujo **fechamento** ficou além do
  nível varrido. É a medida de "aceitação por tempo" disponível sem TPO/volume
  por preço — e por isso é rotulada como ``PROXY`` de tempo de aceitação.
- ``close_back_inside`` = a última barra avaliada fechou de volta do lado de
  origem.
- ``rejection_wick_ratio`` = maior pavio contra o nível / range da barra.

Vereditos:
- ``REJECTION``  — ratio <= limite, fechou de volta e pavio >= mínimo.
- ``ACCEPTANCE`` — maioria dos fechamentos além do nível.
- ``INDECISION`` — nem um nem outro.
- ``NOT_AVAILABLE`` — sem sweep ativo ou sem barras suficientes.

Limitação declarada: aceitação medida por fechamento de barra é aproximação
grosseira de aceitação por *tempo negociado* (TPO) ou *volume aceito*. Com
dados de volume por preço, esta implementação deve ser substituída.
"""

from __future__ import annotations

from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import AcceptanceAssessment, LiquidityAssessment
from ..domain.enums import AcceptanceVerdict, Confidence, SourceKind, SweepOutcome
from ..domain.events import LiquidityPool
from ..domain.market import Bar
from ..domain.measurement import Measurement, MissingMeasurement

__all__ = ["BaselineAcceptanceEngine"]


class BaselineAcceptanceEngine:
    def assess(
        self, ctx: EvaluationContext, liquidity: LiquidityAssessment
    ) -> AcceptanceAssessment:
        cfg = ctx.config.acceptance
        sweep = liquidity.active_sweep

        if sweep is None or sweep.outcome is not SweepOutcome.REJECTED:
            return _na("nenhum sweep confirmado e ativo em as_of")

        pool = _find_pool(liquidity, sweep.pool_id)
        if pool is None:
            return _na(f"pool {sweep.pool_id} do sweep não está mais visível em as_of")

        bars: Sequence[Bar] = ctx.snapshot.closed(cfg.timeframe)
        if not bars:
            return _na(f"sem barras confirmadas em {cfg.timeframe}")

        assert sweep.confirmation_bar_close_time is not None
        after = [b for b in bars if b.close_time > sweep.confirmation_bar_close_time]
        window = after[: cfg.evaluation_bars]

        if len(window) < cfg.evaluation_bars:
            return _na(
                f"aguardando confirmação: {len(window)}/{cfg.evaluation_bars} barras "
                f"fechadas em {cfg.timeframe} após o sweep"
            )

        level = pool.price
        is_high = pool.is_high_side
        beyond = sum(1 for b in window if (b.close > level if is_high else b.close < level))
        ratio = beyond / len(window)
        last = window[-1]
        close_back_inside = last.close < level if is_high else last.close > level

        wick = last.upper_wick if is_high else last.lower_wick
        wick_ratio = None if last.range == 0 else wick / last.range

        ratio_m = Measurement(
            value=ratio,
            unit="ratio",
            source=SourceKind.PROXY,
            proxy_for="time_accepted_beyond_level",
            method=f"closes_beyond/{len(window)} em {cfg.timeframe}",
            sample_size=len(window),
        )
        wick_m: Measurement | MissingMeasurement
        if wick_ratio is None:
            wick_m = MissingMeasurement(
                reason="barra de referência sem range (high==low)", unit="ratio"
            )
        else:
            wick_m = Measurement(
                value=wick_ratio,
                unit="ratio",
                source=SourceKind.DERIVED,
                method="wick_contra_nivel/range",
                sample_size=1,
            )

        notes: list[str] = [
            f"nível={level:.2f} lado={'high' if is_high else 'low'}",
            f"{beyond}/{len(window)} fechamentos além do nível",
            "aceitação medida por fechamento de barra (proxy de tempo aceito)",
        ]

        if (
            ratio <= cfg.max_time_beyond_ratio
            and close_back_inside
            and wick_ratio is not None
            and wick_ratio >= cfg.min_rejection_wick_ratio
        ):
            verdict = AcceptanceVerdict.REJECTION
            confidence = Confidence.MEDIUM if ratio == 0 else Confidence.LOW
        elif ratio > 0.5:
            verdict = AcceptanceVerdict.ACCEPTANCE
            confidence = Confidence.MEDIUM
            notes.append("aceitação além do nível invalida o setup de reversão")
        else:
            verdict = AcceptanceVerdict.INDECISION
            confidence = Confidence.LOW
            if wick_ratio is not None and wick_ratio < cfg.min_rejection_wick_ratio:
                notes.append(
                    f"pavio de rejeição {wick_ratio:.2f} < mínimo "
                    f"{cfg.min_rejection_wick_ratio:.2f}"
                )
            if not close_back_inside:
                notes.append("última barra não fechou de volta ao lado de origem")

        return AcceptanceAssessment(
            verdict=verdict,
            time_beyond_ratio=ratio_m,
            close_back_inside=close_back_inside,
            rejection_wick_ratio=wick_m,
            reference_price=level,
            side=sweep.side,
            confidence=confidence,
            uses_proxy=True,
            notes=tuple(notes),
        )


def _find_pool(liquidity: LiquidityAssessment, pool_id: str) -> LiquidityPool | None:
    for p in liquidity.pools:
        if p.pool_id == pool_id:
            return p
    return None


def _na(reason: str) -> AcceptanceAssessment:
    return AcceptanceAssessment(
        verdict=AcceptanceVerdict.NOT_AVAILABLE,
        time_beyond_ratio=MissingMeasurement(reason=reason, unit="ratio"),
        close_back_inside=None,
        rejection_wick_ratio=MissingMeasurement(reason=reason, unit="ratio"),
        reference_price=None,
        side=None,
        confidence=Confidence.UNKNOWN,
        uses_proxy=True,
        notes=(reason,),
    )
