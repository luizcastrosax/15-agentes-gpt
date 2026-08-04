"""8. Flow Engine (G5).

AVISO ESTRUTURAL — leia antes de confiar neste módulo
-----------------------------------------------------
Fluxo de ordens real exige dados que o MVP **não possui**: trades tick a tick
com identificação do agressor, ou profundidade de livro. Sem isso:

- **Não existe delta.** O que se calcula a partir de OHLCV é uma correlação
  ruidosa com delta, não delta.
- Qualquer número produzido aqui é ``SourceKind.PROXY`` com ``proxy_for``
  declarado.
- Consequentemente, o Gate G5 rebaixa qualquer veredito baseado em proxy para
  ``CONDITIONAL``. Ele nunca retorna ``PASS`` com proxy.

Se ``config.flow.allow_proxy = false``, o engine devolve ``NOT_AVAILABLE`` —
o comportamento correto para quem não aceita decidir com substituto.

Proxies do baseline
-------------------
- ``volume_ratio`` = volume da barra de referência / média das ``lookback``
  barras. Proxy de participação.
- ``aggression_ratio`` = deslocamento direcional (|close-open|/range) da barra
  de referência, com sinal a favor do lado avaliado. Proxy de agressão.

``delta`` é sempre ``MissingMeasurement``: é a declaração explícita de que o
sistema não tem essa informação, em vez de fabricar um número plausível.
"""

from __future__ import annotations

from typing import Sequence

from ..contracts.context import EvaluationContext
from ..domain.assessments import FlowAssessment
from ..domain.enums import Confidence, FlowVerdict, Side, SourceKind
from ..domain.market import Bar
from ..domain.measurement import Measurement, MissingMeasurement

__all__ = ["BaselineFlowEngine"]

_NO_DELTA = MissingMeasurement(
    reason=(
        "delta requer trades tick-a-tick com agressor ou book; "
        "não disponível a partir de OHLCV"
    ),
    unit="contracts",
    expected_source="tick_data_or_order_book",
)


class BaselineFlowEngine:
    def assess(self, ctx: EvaluationContext, side: Side | None) -> FlowAssessment:
        cfg = ctx.config.flow

        if not cfg.allow_proxy:
            return FlowAssessment(
                verdict=FlowVerdict.NOT_AVAILABLE,
                delta=_NO_DELTA,
                volume_ratio=MissingMeasurement(
                    reason="proxies de fluxo desabilitados por configuração", unit="ratio"
                ),
                aggression_ratio=MissingMeasurement(
                    reason="proxies de fluxo desabilitados por configuração", unit="ratio"
                ),
                uses_proxy=False,
                confidence=Confidence.UNKNOWN,
                notes=("config.flow.allow_proxy=false e não há fonte de fluxo real",),
            )

        if side is None:
            return _na("lado da operação indefinido: nada a avaliar")

        bars: Sequence[Bar] = ctx.snapshot.closed(cfg.timeframe)
        if len(bars) < cfg.lookback_bars + 1:
            return _na(
                f"amostra insuficiente em {cfg.timeframe}: {len(bars)} barras, "
                f"exigidas {cfg.lookback_bars + 1}"
            )

        ref = bars[-1]
        window = bars[-(cfg.lookback_bars + 1) : -1]

        volumes = [b.volume for b in window if b.volume is not None]
        vol_measure: Measurement | MissingMeasurement
        if ref.volume is None or len(volumes) < cfg.lookback_bars // 2 or not volumes:
            vol_measure = MissingMeasurement(
                reason="volume ausente na barra de referência ou na janela",
                unit="ratio",
                expected_source="bar_volume",
            )
            vol_ratio = None
        else:
            avg = sum(volumes) / len(volumes)
            if avg <= 0:
                vol_measure = MissingMeasurement(
                    reason="volume médio da janela é zero ou inválido", unit="ratio"
                )
                vol_ratio = None
            else:
                vol_ratio = ref.volume / avg
                vol_measure = Measurement(
                    value=vol_ratio,
                    unit="ratio",
                    source=SourceKind.PROXY,
                    proxy_for="market_participation",
                    method=f"vol_ref/media({len(volumes)} barras)",
                    sample_size=len(volumes) + 1,
                )

        body_ratio = ref.body_ratio()
        if body_ratio is None:
            agg_measure: Measurement | MissingMeasurement = MissingMeasurement(
                reason="barra de referência sem range", unit="ratio"
            )
            signed = None
        else:
            directional = ref.is_bullish if side is Side.LONG else ref.is_bearish
            signed = body_ratio if directional else -body_ratio
            agg_measure = Measurement(
                value=signed,
                unit="ratio",
                source=SourceKind.PROXY,
                proxy_for="order_flow_aggression",
                method="±|close-open|/range da barra de referência",
                sample_size=1,
            )

        notes = [
            "delta real indisponível: nenhum número de delta é fabricado",
            "todas as medidas são PROXY; G5 não pode retornar PASS com proxy",
        ]

        if signed is None:
            return _na("não foi possível medir agressão na barra de referência")

        if signed < 0:
            verdict = FlowVerdict.OPPOSED
            notes.append("deslocamento da barra de referência é contrário ao lado avaliado")
        elif vol_ratio is not None and vol_ratio >= cfg.min_volume_ratio and signed > 0:
            verdict = FlowVerdict.SUPPORTIVE
            notes.append(
                f"participação {vol_ratio:.2f}x >= mínimo {cfg.min_volume_ratio:.2f}x"
            )
        else:
            verdict = FlowVerdict.NEUTRAL
            if vol_ratio is None:
                notes.append("sem volume utilizável: participação não verificável")
            else:
                notes.append(
                    f"participação {vol_ratio:.2f}x < mínimo {cfg.min_volume_ratio:.2f}x"
                )

        return FlowAssessment(
            verdict=verdict,
            delta=_NO_DELTA,
            volume_ratio=vol_measure,
            aggression_ratio=agg_measure,
            uses_proxy=True,
            confidence=Confidence.LOW,
            notes=tuple(notes),
        )


def _na(reason: str) -> FlowAssessment:
    return FlowAssessment(
        verdict=FlowVerdict.NOT_AVAILABLE,
        delta=_NO_DELTA,
        volume_ratio=MissingMeasurement(reason=reason, unit="ratio"),
        aggression_ratio=MissingMeasurement(reason=reason, unit="ratio"),
        uses_proxy=True,
        confidence=Confidence.UNKNOWN,
        notes=(reason,),
    )
