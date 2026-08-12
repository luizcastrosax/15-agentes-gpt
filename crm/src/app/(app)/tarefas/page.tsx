"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/shared";
import type { Activity } from "@/lib/types";

const TYPE_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "purple"> = {
  tarefa: "slate",
  ligacao: "blue",
  reuniao: "purple",
  email: "amber",
  whatsapp: "green",
};

const blank = (): Partial<Activity> => ({
  type: "tarefa",
  title: "",
  description: "",
  contactId: "",
  dealId: "",
  dueDate: todayISO(),
  done: false,
  ownerId: "",
});

export default function TasksPage() {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const [tab, setTab] = useState("abertas");
  const [editing, setEditing] = useState<Partial<Activity> | null>(null);
  const today = todayISO();

  const sorted = useMemo(
    () => [...data.activities].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.activities],
  );

  const groups = useMemo(() => {
    const open = sorted.filter((a) => !a.done);
    return {
      atrasadas: open.filter((a) => a.dueDate && a.dueDate < today),
      hoje: open.filter((a) => a.dueDate === today),
      futuras: open.filter((a) => !a.dueDate || a.dueDate > today),
      concluidas: sorted.filter((a) => a.done).reverse(),
      abertas: open,
    };
  }, [sorted, today]);

  const list =
    tab === "abertas"
      ? groups.abertas
      : tab === "atrasadas"
        ? groups.atrasadas
        : tab === "hoje"
          ? groups.hoje
          : tab === "futuras"
            ? groups.futuras
            : groups.concluidas;

  async function save() {
    if (!editing?.title?.trim()) return toast("Descreva a tarefa.", "erro");
    await mutate({
      type: "upsert",
      collection: "activities",
      item: editing as Record<string, unknown>,
    });
    setEditing(null);
    toast("Tarefa salva.");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tarefas e agenda"
        subtitle="Follow-ups, ligacoes e reunioes da equipe"
        actions={
          <button className="btn-primary btn-sm" onClick={() => setEditing(blank())}>
            Nova tarefa
          </button>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "abertas", label: "Todas abertas", count: groups.abertas.length },
          { id: "atrasadas", label: "Atrasadas", count: groups.atrasadas.length },
          { id: "hoje", label: "Hoje", count: groups.hoje.length },
          { id: "futuras", label: "Proximas", count: groups.futuras.length },
          { id: "concluidas", label: "Concluidas", count: groups.concluidas.length },
        ]}
      />

      <div className="card overflow-hidden">
        {list.length ? (
          <ul className="divide-y divide-slate-100">
            {list.map((a) => {
              const contact = data.contacts.find((c) => c.id === a.contactId);
              const late = !a.done && a.dueDate && a.dueDate < today;
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={a.done}
                    onChange={() => mutate({ type: "activity.toggle", id: a.id })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${a.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {a.title}
                    </p>
                    {a.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge tone={TYPE_TONE[a.type]}>{a.type}</Badge>
                      <span className={late ? "font-medium text-rose-600" : ""}>
                        {a.dueDate ? fmtDate(a.dueDate) : "sem prazo"}
                      </span>
                      {contact && (
                        <Link href={`/contatos/${contact.id}`} className="link">
                          {contact.name}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(a)}>
                      Editar
                    </button>
                    <ConfirmButton
                      onConfirm={() => mutate({ type: "remove", collection: "activities", id: a.id })}
                    >
                      Excluir
                    </ConfirmButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="Nada por aqui"
            description="Sem tarefas nesta visao."
            action={
              <button className="btn-primary btn-sm" onClick={() => setEditing(blank())}>
                Nova tarefa
              </button>
            }
          />
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar tarefa" : "Nova tarefa"}
        footer={
          <>
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
            <Field label="Titulo" className="sm:col-span-2">
              <Input
                value={editing.title || ""}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </Field>
            <Field label="Tipo">
              <Select
                value={editing.type || "tarefa"}
                onChange={(e) => setEditing({ ...editing, type: e.target.value as Activity["type"] })}
              >
                <option value="tarefa">Tarefa</option>
                <option value="ligacao">Ligacao</option>
                <option value="reuniao">Reuniao</option>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </Select>
            </Field>
            <Field label="Prazo">
              <Input
                type="date"
                value={editing.dueDate || ""}
                onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })}
              />
            </Field>
            <Field label="Contato">
              <Select
                value={editing.contactId || ""}
                onChange={(e) => setEditing({ ...editing, contactId: e.target.value })}
              >
                <option value="">Nenhum</option>
                {data.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
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
            <Field label="Detalhes" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
