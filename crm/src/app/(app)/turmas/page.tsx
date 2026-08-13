"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { ShareLink } from "@/components/ShareLink";
import { ProgressBar } from "@/components/charts";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
} from "@/components/ui";
import { WEEKDAYS, brl, fmtDate, pct, searchMatch, todayISO } from "@/lib/shared";
import { classAttendanceRate, rosterOf, seatsLeft } from "@/lib/selectors";
import type { CourseClass } from "@/lib/types";

const STATUS_TONE: Record<string, "slate" | "green" | "blue" | "purple" | "red"> = {
  planejada: "slate",
  aberta: "blue",
  "em-andamento": "green",
  concluida: "purple",
  cancelada: "red",
};

const blank = (courseId: string): Partial<CourseClass> => ({
  courseId,
  name: "",
  teacher: "",
  location: "",
  startDate: todayISO(),
  endDate: todayISO(),
  weekDays: [2, 4],
  startTime: "19:00",
  endTime: "22:00",
  capacity: 30,
  price: null,
  status: "aberta",
  enrollOpen: true,
  minAttendancePct: 75,
});

export default function ClassesPage() {
  const { data, mutate, baseUrl } = useCrm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Partial<CourseClass> | null>(null);
  const [sharing, setSharing] = useState<CourseClass | null>(null);

  const classes = useMemo(
    () =>
      data.classes
        .filter((c) => (statusFilter ? c.status === statusFilter : true))
        .filter((c) => {
          const course = data.courses.find((x) => x.id === c.courseId);
          return searchMatch(`${c.name} ${c.teacher} ${course?.name || ""}`, q);
        })
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [data.classes, data.courses, q, statusFilter],
  );

  async function save() {
    if (!editing?.name?.trim()) return toast("Informe o nome da turma.", "erro");
    if (!editing.courseId) return toast("Escolha o curso.", "erro");
    const isNew = !editing.id;
    const [saved] = (await mutate({
      type: "upsert",
      collection: "classes",
      item: {
        ...editing,
        capacity: Number(editing.capacity) || 0,
        minAttendancePct: Number(editing.minAttendancePct) || 75,
        price: editing.price === null || editing.price === undefined || String(editing.price) === "" ? null : Number(editing.price),
      } as Record<string, unknown>,
    })) as [CourseClass];
    setEditing(null);
    toast("Turma salva.");
    if (isNew && saved?.id) {
      await mutate({ type: "sessions.generate", classId: saved.id });
      toast("Aulas geradas conforme o calendario.");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Turmas"
        subtitle="Calendario, vagas, link de inscricao e frequencia"
        actions={
          <>
            <Input
              placeholder="Buscar turma..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full sm:w-52"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-auto"
            >
              <option value="">Todas situacoes</option>
              <option value="planejada">Planejada</option>
              <option value="aberta">Aberta</option>
              <option value="em-andamento">Em andamento</option>
              <option value="concluida">Concluida</option>
              <option value="cancelada">Cancelada</option>
            </Select>
            <button
              className="btn-primary btn-sm"
              onClick={() => setEditing(blank(data.courses[0]?.id || ""))}
            >
              Nova turma
            </button>
          </>
        }
      />

      {classes.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {classes.map((c) => {
            const course = data.courses.find((x) => x.id === c.courseId);
            const roster = rosterOf(data, c.id);
            const left = seatsLeft(data, c);
            const rate = classAttendanceRate(data, c.id);
            const sessions = data.sessions.filter((s) => s.classId === c.id);
            const held = sessions.filter((s) => s.status === "realizada").length;
            return (
              <div key={c.id} className="card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/turmas/${c.id}`}
                      className="block truncate text-[15px] font-semibold text-slate-900 hover:text-indigo-700"
                    >
                      {c.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {course?.name} - {c.teacher || "sem professor"}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] text-slate-500">Periodo</p>
                    <p className="font-medium text-slate-800">
                      {fmtDate(c.startDate)} a {fmtDate(c.endDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Dias</p>
                    <p className="font-medium text-slate-800">
                      {c.weekDays.map((d) => WEEKDAYS[d]).join(", ") || "-"} {c.startTime}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Matriculados</p>
                    <p className="font-medium text-slate-800">
                      {roster.length}/{c.capacity} ({left} vagas)
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Aulas</p>
                    <p className="font-medium text-slate-800">
                      {held}/{sessions.length} realizadas
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Frequencia media</span>
                    <span className="font-semibold text-slate-700">{pct(rate)}</span>
                  </div>
                  <ProgressBar
                    value={rate}
                    color={rate >= (c.minAttendancePct || 75) / 100 ? "#16a34a" : "#f59e0b"}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-900">
                    {brl(c.price ?? course?.price ?? 0)}
                  </span>
                  {c.enrollOpen ? (
                    <Badge tone="green">inscricoes abertas</Badge>
                  ) : (
                    <Badge tone="slate">inscricoes fechadas</Badge>
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <button className="btn-primary btn-sm" onClick={() => setSharing(c)}>
                      Link de inscricao
                    </button>
                    <Link href={`/turmas/${c.id}`} className="btn-ghost btn-sm">
                      Abrir
                    </Link>
                    <button className="btn-sub btn-sm" onClick={() => setEditing(c)}>
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title="Nenhuma turma"
            description="Crie uma turma para gerar o link de inscricao e o calendario de aulas."
            action={
              <button
                className="btn-primary btn-sm"
                onClick={() => setEditing(blank(data.courses[0]?.id || ""))}
              >
                Nova turma
              </button>
            }
          />
        </div>
      )}

      {/* Compartilhar link */}
      <Modal
        open={!!sharing}
        onClose={() => setSharing(null)}
        title="Link de inscricao da turma"
        wide
        footer={
          <>
            <ConfirmButton
              className="btn-ghost btn-sm mr-auto"
              message="Gerar um novo link? O link antigo deixara de funcionar."
              onConfirm={async () => {
                if (!sharing) return;
                await mutate({ type: "class.rotateToken", id: sharing.id });
                setSharing(null);
                toast("Novo link gerado.");
              }}
            >
              Gerar novo link
            </ConfirmButton>
            <button className="btn-primary btn-sm" onClick={() => setSharing(null)}>
              Fechar
            </button>
          </>
        }
      >
        {sharing && (
          <div className="space-y-4">
            <ShareLink
              url={`${baseUrl}/i/${sharing.enrollToken}`}
              title="Formulario publico de inscricao"
              description="Envie para os interessados. Cada inscricao cria automaticamente um contato, uma pre-matricula e um negocio no funil."
              whatsappMessage={`Ola! Inscricoes abertas para ${sharing.name}. Faca sua inscricao aqui: ${baseUrl}/i/${sharing.enrollToken}`}
            />
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sharing.enrollOpen}
                  onChange={async (e) => {
                    await mutate({
                      type: "upsert",
                      collection: "classes",
                      item: { id: sharing.id, enrollOpen: e.target.checked },
                    });
                    setSharing({ ...sharing, enrollOpen: e.target.checked });
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                Inscricoes abertas
              </label>
              <span className="ml-auto text-[13px] text-slate-500">
                {seatsLeft(data, sharing)} vagas restantes
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* Formulario da turma */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar turma" : "Nova turma"}
        wide
        footer={
          <>
            {editing?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                message="Excluir a turma? Aulas, presencas e matriculas dela serao removidas."
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "classes", id: editing.id! });
                  setEditing(null);
                  toast("Turma excluida.");
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={save}>
              Salvar turma
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Curso *">
              <Select
                value={editing.courseId || ""}
                onChange={(e) => {
                  const course = data.courses.find((c) => c.id === e.target.value);
                  setEditing({
                    ...editing,
                    courseId: e.target.value,
                    name: editing.name || `${course?.name || ""} - Turma`,
                  });
                }}
              >
                <option value="">Selecione...</option>
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome da turma *">
              <Input
                value={editing.name || ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Professor">
              <Input
                value={editing.teacher || ""}
                onChange={(e) => setEditing({ ...editing, teacher: e.target.value })}
              />
            </Field>
            <Field label="Local / sala">
              <Input
                value={editing.location || ""}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
              />
            </Field>
            <Field label="Inicio">
              <Input
                type="date"
                value={editing.startDate || ""}
                onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
              />
            </Field>
            <Field label="Termino">
              <Input
                type="date"
                value={editing.endDate || ""}
                onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
              />
            </Field>
            <Field label="Horario de inicio">
              <Input
                type="time"
                value={editing.startTime || ""}
                onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
              />
            </Field>
            <Field label="Horario de termino">
              <Input
                type="time"
                value={editing.endTime || ""}
                onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
              />
            </Field>

            <div className="sm:col-span-2">
              <label className="label">Dias da semana</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => {
                  const on = (editing.weekDays || []).includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          weekDays: on
                            ? (editing.weekDays || []).filter((x) => x !== i)
                            : [...(editing.weekDays || []), i].sort(),
                        })
                      }
                      className={`h-9 w-11 rounded-lg border text-[13px] font-medium transition ${
                        on
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Vagas">
              <Input
                type="number"
                value={editing.capacity ?? 0}
                onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })}
              />
            </Field>
            <Field
              label="Valor especifico (R$)"
              hint="Deixe vazio para usar o valor padrao do curso."
            >
              <Input
                type="number"
                step="0.01"
                value={editing.price ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    price: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Situacao">
              <Select
                value={editing.status || "aberta"}
                onChange={(e) =>
                  setEditing({ ...editing, status: e.target.value as CourseClass["status"] })
                }
              >
                <option value="planejada">Planejada</option>
                <option value="aberta">Aberta</option>
                <option value="em-andamento">Em andamento</option>
                <option value="concluida">Concluida</option>
                <option value="cancelada">Cancelada</option>
              </Select>
            </Field>
            <Field label="Frequencia minima (%)" hint="Usada para alertar alunos em risco.">
              <Input
                type="number"
                min={0}
                max={100}
                value={editing.minAttendancePct ?? 75}
                onChange={(e) =>
                  setEditing({ ...editing, minAttendancePct: Number(e.target.value) })
                }
              />
            </Field>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editing.enrollOpen !== false}
                  onChange={(e) => setEditing({ ...editing, enrollOpen: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                Aceitar inscricoes pelo link publico
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
