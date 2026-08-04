"""10. Risk Engine (G7).

Verifica se o plano cabe no orçamento de risco. Fail-closed em toda ausência:

- ``AccountState`` ausente ou obsoleto ⇒ ``ACCOUNT_STATE_STALE`` /
  ``RISK_STATE_UNKNOWN`` ⇒ reprova. Conta desconhecida **não** é conta zerada.
- ``SessionRiskLedger`` com campos ``None`` ⇒ ``RISK_STATE_UNKNOWN`` ⇒ reprova
  (quando ``block_on_unknown_state=true``). Não saber quantos trades já foram
  feitos hoje não é o mesmo que zero trades.

``risk_budget`` devolve o dinheiro disponível para *este* trade, já descontado
o que a sessão consumiu. Devolve ``None`` quando o estado é desconhecido — e
``None`` faz o Execution Engine dimensionar zero contratos.
"""

from __future__ import annotations

from ..contracts.context import EvaluationContext
from ..domain.assessments import RiskAssessment, TradePlan
from ..domain.enums import RiskBreach

__all__ = ["BaselineRiskEngine"]


class BaselineRiskEngine:
    def risk_budget(self, ctx: EvaluationContext) -> float | None:
        cfg = ctx.config.risk
        account = ctx.account
        if account is None or account.is_stale(ctx.now):
            return None
        per_trade = account.equity * (cfg.max_risk_pct_per_trade / 100.0)

        ledger = ctx.risk_ledger
        if ledger is None or ledger.realized_pnl is None:
            return None if cfg.block_on_unknown_state else per_trade

        daily_limit = account.equity * (cfg.daily_loss_limit_pct / 100.0)
        consumed = max(0.0, -ledger.realized_pnl)
        remaining = daily_limit - consumed
        if remaining <= 0:
            return 0.0
        return min(per_trade, remaining)

    def assess(self, ctx: EvaluationContext, plan: TradePlan | None) -> RiskAssessment:
        cfg = ctx.config.risk
        breaches: list[RiskBreach] = []
        notes: list[str] = []
        account = ctx.account
        ledger = ctx.risk_ledger

        state_known = True

        if account is None:
            breaches.append(RiskBreach.RISK_STATE_UNKNOWN)
            notes.append("estado de conta indisponível: equity desconhecida (≠ zero)")
            state_known = False
        elif account.is_stale(ctx.now):
            breaches.append(RiskBreach.ACCOUNT_STATE_STALE)
            age = (ctx.now - account.as_of).total_seconds()
            notes.append(
                f"snapshot de conta obsoleto: {age:.1f}s > {account.max_age_seconds:.1f}s"
            )
            state_known = False

        if ledger is None:
            breaches.append(RiskBreach.RISK_STATE_UNKNOWN)
            notes.append("ledger de risco da sessão indisponível")
            state_known = False
        else:
            if ledger.trades_taken is None or ledger.realized_pnl is None:
                breaches.append(RiskBreach.RISK_STATE_UNKNOWN)
                notes.append(
                    "ledger incompleto (trades_taken/realized_pnl ausentes): "
                    "ausência não é zero"
                )
                state_known = False
            else:
                if ledger.trades_taken >= cfg.max_trades_per_session:
                    breaches.append(RiskBreach.MAX_TRADES_PER_SESSION)
                    notes.append(
                        f"{ledger.trades_taken} trades já executados hoje "
                        f"(limite {cfg.max_trades_per_session})"
                    )
                if account is not None:
                    limit = account.equity * (cfg.daily_loss_limit_pct / 100.0)
                    if -ledger.realized_pnl >= limit:
                        breaches.append(RiskBreach.DAILY_LOSS_LIMIT)
                        notes.append(
                            f"perda do dia {-ledger.realized_pnl:.2f} atingiu o limite "
                            f"{limit:.2f}"
                        )
            if (
                ledger.consecutive_losses is not None
                and ledger.consecutive_losses >= cfg.max_consecutive_losses
            ):
                breaches.append(RiskBreach.MAX_CONSECUTIVE_LOSSES)
                notes.append(
                    f"{ledger.consecutive_losses} perdas consecutivas "
                    f"(limite {cfg.max_consecutive_losses})"
                )

        budget = self.risk_budget(ctx)
        risk_money = plan.risk_money if plan is not None else None
        risk_pct = None
        if plan is not None and account is not None and account.equity > 0:
            risk_pct = 100.0 * plan.risk_money / account.equity
            if risk_pct > cfg.max_risk_pct_per_trade + 1e-9:
                breaches.append(RiskBreach.PER_TRADE_RISK_EXCEEDED)
                notes.append(
                    f"risco do plano {risk_pct:.3f}% > máximo "
                    f"{cfg.max_risk_pct_per_trade:.3f}%"
                )
            if plan.quantity > cfg.max_contracts:
                breaches.append(RiskBreach.PER_TRADE_RISK_EXCEEDED)
                notes.append(
                    f"quantidade {plan.quantity} > max_contracts {cfg.max_contracts}"
                )
        if plan is not None and budget is not None and plan.risk_money > budget + 1e-9:
            breaches.append(RiskBreach.PER_TRADE_RISK_EXCEEDED)
            notes.append(
                f"risco do plano {plan.risk_money:.2f} > orçamento restante {budget:.2f}"
            )

        if not state_known and not cfg.block_on_unknown_state:
            notes.append(
                "ATENÇÃO: block_on_unknown_state=false — o sistema está configurado "
                "para tolerar estado desconhecido, o que contraria a política "
                "fail-closed padrão"
            )
            breaches = [b for b in breaches if b is not RiskBreach.RISK_STATE_UNKNOWN]

        approved = not breaches and plan is not None
        if plan is None:
            notes.append("sem plano para avaliar")

        return RiskAssessment(
            approved=approved,
            breaches=tuple(dict.fromkeys(breaches)),
            risk_money=risk_money,
            risk_pct_of_equity=risk_pct,
            remaining_daily_risk=budget,
            trades_taken_today=(ledger.trades_taken if ledger else None),
            account_state_known=state_known,
            notes=tuple(notes),
        )
