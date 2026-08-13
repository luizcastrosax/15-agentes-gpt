"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import {
  Badge,
  Checkbox,
  ConfirmButton,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { brl, fmtDate, pct, searchMatch, todayISO } from "@/lib/shared";
import { conversionRate, pipelineValue, weightedPipeline } from "@/lib/selectors";
import type { Deal } from "@/lib/types";

const emptyDeal = (stageId: string): Partial<Deal> => ({
  title: "",
  contactId: "",
  courseId: "",
  classId: "",
  value: 0,
  stageId,
  status: "aberto",
  probability: 30,
  expectedCloseDate: todayISO(),
  source: "",
  ownerId: "",
});

export default function FunnelPage() {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [editing, setEditing] = useState<Partial<Deal> | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<Deal | null>(null);
  const [lostReason, setLostReason] = useState("");

  const stages = useMemo(() => [...data.stages].sort((a, b) => a.order - b.order), [data.stages]);

  const visibleDeals = useMemo(() => {
    return data.deals.filter((d) => {
      const contact = data.contacts.find((c) => c.id === d.contactId);
      if (ownerFilter && d.ownerId !== ownerFilter) return false;
      return searchMatch(`${d.title} ${contact?.name || ""} ${contact?.email || ""}`, q);
    });
  }, [data, q, ownerFilter]);

  const byStage = (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    return visibleDeals.filter((d) => {
      if (d.stageId !== stageId) return false;
      if (stage?.kind === "open") return d.status === "aberto";
      return true;
    });
  };

  async function save() {
    if (!editing) return;
    if (!editing.title?.trim()) return toast("Informe o titulo do negocio.", "erro");
    await mutate({
      type: "upsert",
      collection: "deals",
      item: {
        ...editing,
        value: Number(editing.value) || 0,
        probability: Number(editing.probability) || 0,
      } as Record<string, unknown>,
    });
    setEditing(null);
    toast("Negocio salvo.");
  }

  async function drop(stageId: string) {
    if (!dragId) return;
    const stage = stages.find((s) => s.id === stageId);
    const deal = data.deals.find((d) => d.id === dragId);
    setDragId(null);
    if (!deal || deal.stageId === stageId) return;
    if (stage?.kind === "lost") {
      setLostReason(data.lostReasons[0] || "");
      setLostFor(deal);
      return;
    }
    await mutate({ type: "deal.move", id: dragId, stageId });
    if (stage?.kind === "won") toast("Negocio ganho! Lembre de criar a matricula.");
  }

  const totalOpen = pipelineValue(data);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funil de vendas"
        subtitle={`${brl(totalOpen)} em aberto - previsao ponderada ${brl(weightedPipeline(data))} - conversao ${pct(conversionRate(data))}`}
        actions={
          <>
            <Input
              placeholder="Buscar negocio ou contato..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full sm:w-56"
            />
            <Select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="w-auto">
              <option value="">Todos responsaveis</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <button className="btn-primary btn-sm" onClick={() => setEditing(emptyDeal(stages[0]?.id || ""))}>
              Novo negocio
            </button>
          </>
        }
      />

      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const deals = byStage(stage.id);
          const total = deals.reduce((a, d) => a + (d.value || 0), 0);
          return (
            <div
              key={stage.id}
              className="flex w-[280px] shrink-0 flex-col rounded-xl bg-slate-100/70"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(stage.id)}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-[13px] font-semibold text-slate-700">{stage.name}</span>
                <span className="rounded-full bg-white px-1.5 text-[11px] font-medium text-slate-500">
                  {deals.length}
                </span>
                <span className="ml-auto text-[11px] font-medium text-slate-500">{brl(total)}</span>
              </div>

              <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2">
                {deals.map((deal) => {
                  const contact = data.contacts.find((c) => c.id === deal.contactId);
                  const course = data.courses.find((c) => c.id === deal.courseId);
                  const late =
                    deal.status === "aberto" &&
                    deal.expectedCloseDate &&
                    deal.expectedCloseDate < todayISO();
                  return (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDragId(deal.id)}
                      onClick={() => setEditing(deal)}
                      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow"
                    >
                      <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{deal.title}</p>
                      {contact && (
                        <p className="mt-1 truncate text-xs text-slate-500">{contact.name}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-slate-900">
                          {brl(deal.value)}
                        </span>
                        {stage.kind === "open" && (
                          <Badge tone="slate">{deal.probability}%</Badge>
                        )}
                        {deal.status === "ganho" && <Badge tone="green">ganho</Badge>}
                        {deal.status === "perdido" && <Badge tone="red">perdido</Badge>}
                      </div>
                      {course && (
                        <p className="mt-1.5 truncate text-[11px] text-slate-400">{course.name}</p>
                      )}
                      {deal.expectedCloseDate && deal.status === "aberto" && (
                        <p
                          className={`mt-1.5 text-[11px] ${late ? "font-medium text-rose-600" : "text-slate-400"}`}
                        >
                          Previsao: {fmtDate(deal.expectedCloseDate)}
                        </p>
                      )}
                    </div>
                  );
                })}
                {!deals.length && (
                  <p className="px-2 py-6 text-center text-xs text-slate-400">
                    Arraste negocios para ca
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar negocio" : "Novo negocio"}
        wide
        footer={
          <>
            {editing?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "deals", id: editing.id! });
                  setEditing(null);
                  toast("Negocio excluido.");
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Titulo" className="sm:col-span-2">
              <Input
                value={editing.title || ""}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="Ex.: Excel Avancado - Ana"
              />
            </Field>
            <Field label="Contato">
              <Select
                value={editing.contactId || ""}
                onChange={(e) => setEditing({ ...editing, contactId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {data.contacts
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Etapa">
              <Select
                value={editing.stageId || ""}
                onChange={(e) => setEditing({ ...editing, stageId: e.target.value })}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Curso de interesse">
              <Select
                value={editing.courseId || ""}
                onChange={(e) => {
                  const course = data.courses.find((c) => c.id === e.target.value);
                  setEditing({
                    ...editing,
                    courseId: e.target.value,
                    value: editing.value || course?.price || 0,
                    title: editing.title || course?.name || "",
                  });
                }}
              >
                <option value="">Nenhum</option>
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Turma">
              <Select
                value={editing.classId || ""}
                onChange={(e) => setEditing({ ...editing, classId: e.target.value })}
              >
                <option value="">Nenhuma</option>
                {data.classes
                  .filter((c) => !editing.courseId || c.courseId === editing.courseId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <Input
                type="number"
                step="0.01"
                value={editing.value ?? 0}
                onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })}
              />
            </Field>
            <Field label="Probabilidade (%)">
              <Input
                type="number"
                min={0}
                max={100}
                value={editing.probability ?? 0}
                onChange={(e) => setEditing({ ...editing, probability: Number(e.target.value) })}
              />
            </Field>
            <Field label="Previsao de fechamento">
              <Input
                type="date"
                value={editing.expectedCloseDate || ""}
                onChange={(e) => setEditing({ ...editing, expectedCloseDate: e.target.value })}
              />
            </Field>
            <Field label="Responsavel">
              <Select
                value={editing.ownerId || ""}
                onChange={(e) => setEditing({ ...editing, ownerId: e.target.value })}
              >
                <option value="">Sem responsavel</option>
                {data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Origem">
              <Select
                value={editing.source || ""}
                onChange={(e) => setEditing({ ...editing, source: e.target.value })}
              >
                <option value="">Nao informado</option>
                {data.sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>

            {editing.id && editing.contactId && (
              <div className="sm:col-span-2 flex flex-wrap gap-2 rounded-lg bg-slate-50 p-3">
                <Link href={`/contatos/${editing.contactId}`} className="btn-ghost btn-sm">
                  Abrir contato
                </Link>
                <button
                  className="btn-sub btn-sm"
                  onClick={async () => {
                    await mutate({ type: "deal.close", id: editing.id!, status: "ganho" });
                    setEditing(null);
                    toast("Negocio marcado como ganho.");
                  }}
                >
                  Marcar como ganho
                </button>
                <button
                  className="btn-sub btn-sm"
                  onClick={() => {
                    const deal = data.deals.find((d) => d.id === editing.id);
                    if (deal) {
                      setLostReason(data.lostReasons[0] || "");
                      setLostFor(deal);
                      setEditing(null);
                    }
                  }}
                >
                  Marcar como perdido
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!lostFor}
        onClose={() => setLostFor(null)}
        title="Motivo da perda"
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setLostFor(null)}>
              Cancelar
            </button>
            <button
              className="btn-danger btn-sm"
              onClick={async () => {
                if (!lostFor) return;
                await mutate({
                  type: "deal.close",
                  id: lostFor.id,
                  status: "perdido",
                  lostReason,
                });
                setLostFor(null);
                toast("Negocio marcado como perdido.");
              }}
            >
              Confirmar perda
            </button>
          </>
        }
      >
        <Field label="Por que o negocio foi perdido?">
          <Select value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
            {data.lostReasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="Outro">Outro</option>
          </Select>
        </Field>
      </Modal>
    </div>
  );
}
