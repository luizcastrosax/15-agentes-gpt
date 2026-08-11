"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { BarChart } from "@/components/charts";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  useToast,
} from "@/components/ui";
import { brl, downloadFile, fmtDate, searchMatch, toCSV, todayISO } from "@/lib/shared";
import { effectiveStatus, financeSummary, monthlySeries } from "@/lib/selectors";
import type { Payment } from "@/lib/types";

const blank = (): Partial<Payment> => ({
  contactId: "",
  enrollmentId: "",
  description: "",
  amount: 0,
  dueDate: todayISO(),
  paidAt: "",
  method: "Pix",
  status: "pendente",
  installment: 1,
  installments: 1,
});

export default function FinancePage() {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [month, setMonth] = useState("");
  const [editing, setEditing] = useState<Partial<Payment> | null>(null);

  const summary = useMemo(() => financeSummary(data), [data]);
  const series = useMemo(() => monthlySeries(data, 6), [data]);

  const rows = useMemo(
    () =>
      data.payments
        .map((p) => ({ ...p, effective: effectiveStatus(p) }))
        .filter((p) => (status ? p.effective === status : true))
        .filter((p) => (month ? p.dueDate.slice(0, 7) === month : true))
        .filter((p) => {
          const c = data.contacts.find((x) => x.id === p.contactId);
          return searchMatch(`${c?.name || ""} ${p.description}`, q);
        })
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data, q, status, month],
  );

  const months = useMemo(() => {
    const set = new Set(data.payments.map((p) => p.dueDate.slice(0, 7)));
    return [...set].sort().reverse();
  }, [data.payments]);

  async function save() {
    if (!editing?.contactId) return toast("Escolha o contato.", "erro");
    if (!editing.description?.trim()) return toast("Informe a descricao.", "erro");
    await mutate({
      type: "upsert",
      collection: "payments",
      item: { ...editing, amount: Number(editing.amount) || 0 } as Record<string, unknown>,
    });
    setEditing(null);
    toast("Lancamento salvo.");
  }

  function exportCSV() {
    downloadFile(
      `financeiro-${todayISO()}.csv`,
      toCSV(
        rows.map((p) => ({
          Aluno: data.contacts.find((c) => c.id === p.contactId)?.name || "",
          Descricao: p.description,
          Vencimento: fmtDate(p.dueDate),
          Valor: p.amount,
          Situacao: p.effective,
          "Pago em": p.paidAt ? fmtDate(p.paidAt) : "",
          Forma: p.method,
        })),
      ),
    );
    toast("Relatorio exportado.");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financeiro"
        subtitle="Mensalidades, recebimentos e inadimplencia"
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={exportCSV}>
              Exportar
            </button>
            <button className="btn-primary btn-sm" onClick={() => setEditing(blank())}>
              Novo lancamento
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Recebido no mes" value={brl(summary.receivedThisMonth)} tone="green" />
        <Stat
          label="A receber no mes"
          value={brl(summary.dueThisMonth)}
          hint={`${summary.pendingCount} parcelas pendentes`}
          tone="indigo"
        />
        <Stat
          label="Em atraso"
          value={brl(summary.overdueAmount)}
          hint={`${summary.overdueCount} parcelas vencidas`}
          tone="red"
        />
        <Stat label="Total recebido" value={brl(summary.received)} tone="slate" />
      </div>

      <div className="card-pad">
        <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Receita recebida por mes</h2>
        <BarChart
          data={series.map((s) => ({ label: s.label, value: s.revenue }))}
          format={(v) => brl(v)}
          color="#16a34a"
        />
      </div>

      <div className="card-pad grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input placeholder="Buscar aluno ou descricao..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas situacoes</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="atrasado">Atrasado</option>
        </Select>
        <Select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m.slice(5)}/{m.slice(0, 4)}
            </option>
          ))}
        </Select>
        <div className="flex items-center text-[13px] text-slate-500">
          {rows.length} lancamento(s) - {brl(rows.reduce((a, p) => a + p.amount, 0))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Aluno</th>
                  <th className="th">Descricao</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Valor</th>
                  <th className="th">Situacao</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const c = data.contacts.find((x) => x.id === p.contactId);
                  return (
                    <tr key={p.id} className="row-hover">
                      <td className="td">
                        <Link href={`/contatos/${p.contactId}`} className="font-medium text-slate-800 hover:text-indigo-700">
                          {c?.name || "-"}
                        </Link>
                      </td>
                      <td className="td text-slate-600">{p.description}</td>
                      <td className="td whitespace-nowrap text-slate-600">{fmtDate(p.dueDate)}</td>
                      <td className="td font-medium">{brl(p.amount)}</td>
                      <td className="td">
                        <Badge
                          tone={
                            p.effective === "pago"
                              ? "green"
                              : p.effective === "atrasado"
                                ? "red"
                                : "amber"
                          }
                        >
                          {p.effective}
                        </Badge>
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          {p.effective === "pago" ? (
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => mutate({ type: "payment.unpay", id: p.id })}
                            >
                              Desfazer
                            </button>
                          ) : (
                            <button
                              className="btn-sub btn-sm"
                              onClick={() =>
                                mutate({ type: "payment.pay", id: p.id, paidAt: todayISO() })
                              }
                            >
                              Dar baixa
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" onClick={() => setEditing(p)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhum lancamento"
            description="Crie matriculas com parcelas ou lance uma cobranca avulsa."
            action={
              <button className="btn-primary btn-sm" onClick={() => setEditing(blank())}>
                Novo lancamento
              </button>
            }
          />
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar lancamento" : "Novo lancamento"}
        footer={
          <>
            {editing?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "payments", id: editing.id! });
                  setEditing(null);
                  toast("Lancamento excluido.");
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={save}>
              Salvar
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Aluno / contato" className="sm:col-span-2">
              <Select
                value={editing.contactId || ""}
                onChange={(e) => setEditing({ ...editing, contactId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {data.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Descricao" className="sm:col-span-2">
              <Input
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="Ex.: Mensalidade marco"
              />
            </Field>
            <Field label="Valor (R$)">
              <Input
                type="number"
                step="0.01"
                value={editing.amount ?? 0}
                onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Vencimento">
              <Input
                type="date"
                value={editing.dueDate || ""}
                onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })}
              />
            </Field>
            <Field label="Forma de pagamento">
              <Select
                value={editing.method || ""}
                onChange={(e) => setEditing({ ...editing, method: e.target.value })}
              >
                {["Pix", "Cartao de credito", "Boleto", "Dinheiro", "Transferencia", "Empresa paga"].map(
                  (m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="Pago em" hint="Deixe vazio se ainda nao foi pago.">
              <Input
                type="date"
                value={editing.paidAt || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    paidAt: e.target.value,
                    status: e.target.value ? "pago" : "pendente",
                  })
                }
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
