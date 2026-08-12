"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { ShareLink } from "@/components/ShareLink";
import { ProgressBar } from "@/components/charts";
import {
  Avatar,
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  useToast,
} from "@/components/ui";
import { WEEKDAYS, brl, downloadFile, fmtDate, pct, toCSV, todayISO } from "@/lib/shared";
import { attendanceRate, classAttendanceRate, rosterOf, seatsLeft } from "@/lib/selectors";
import type { ClassSession } from "@/lib/types";

export default function ClassDetailPage() {
  const { data, mutate, baseUrl } = useCrm();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const klass = data.classes.find((c) => c.id === params.id);

  const [tab, setTab] = useState("alunos");
  const [addOpen, setAddOpen] = useState(false);
  const [addContactId, setAddContactId] = useState("");
  const [sessionEdit, setSessionEdit] = useState<Partial<ClassSession> | null>(null);
  const [shareSession, setShareSession] = useState<ClassSession | null>(null);

  const roster = useMemo(() => (klass ? rosterOf(data, klass.id) : []), [data, klass]);
  const sessions = useMemo(
    () =>
      data.sessions
        .filter((s) => s.classId === params.id)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [data.sessions, params.id],
  );

  if (!klass) {
    return (
      <EmptyState
        title="Turma nao encontrada"
        action={
          <Link href="/turmas" className="btn-primary btn-sm">
            Voltar
          </Link>
        }
      />
    );
  }

  const course = data.courses.find((c) => c.id === klass.courseId);
  const rate = classAttendanceRate(data, klass.id);
  const enrollUrl = `${baseUrl}/i/${klass.enrollToken}`;

  function exportRoster() {
    const rows = roster.map((e) => {
      const c = data.contacts.find((x) => x.id === e.contactId);
      const stat = attendanceRate(data, e.contactId, klass!.id);
      return {
        Aluno: c?.name || "",
        Email: c?.email || "",
        Telefone: c?.phone || "",
        Situacao: e.status,
        Valor: e.price - e.discount,
        Presencas: stat.present,
        "Aulas realizadas": stat.held,
        Frequencia: pct(stat.rate),
      };
    });
    downloadFile(`turma-${klass!.name}.csv`, toCSV(rows));
    toast("Lista exportada.");
  }

  async function saveSession() {
    if (!sessionEdit?.date) return toast("Informe a data da aula.", "erro");
    await mutate({
      type: "upsert",
      collection: "sessions",
      item: { classId: klass!.id, ...sessionEdit } as Record<string, unknown>,
    });
    setSessionEdit(null);
    toast("Aula salva.");
  }

  return (
    <div className="space-y-4">
      <Link href="/turmas" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Turmas
      </Link>

      <PageHeader
        title={klass.name}
        subtitle={`${course?.name || ""} - ${klass.teacher || "sem professor"} - ${klass.location || "sem local"}`}
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={exportRoster}>
              Exportar lista
            </button>
            <button className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              Adicionar aluno
            </button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-pad">
          <p className="text-xs text-slate-500">Matriculados</p>
          <p className="text-xl font-semibold text-slate-900">
            {roster.length}
            <span className="text-sm font-normal text-slate-400">/{klass.capacity}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{seatsLeft(data, klass)} vagas livres</p>
        </div>
        <div className="card-pad">
          <p className="text-xs text-slate-500">Frequencia media</p>
          <p className="text-xl font-semibold text-slate-900">{pct(rate)}</p>
          <div className="mt-2">
            <ProgressBar value={rate} color={rate >= klass.minAttendancePct / 100 ? "#16a34a" : "#f59e0b"} />
          </div>
        </div>
        <div className="card-pad">
          <p className="text-xs text-slate-500">Aulas</p>
          <p className="text-xl font-semibold text-slate-900">
            {sessions.filter((s) => s.status === "realizada").length}
            <span className="text-sm font-normal text-slate-400">/{sessions.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {klass.weekDays.map((d) => WEEKDAYS[d]).join(", ")} - {klass.startTime}
          </p>
        </div>
        <div className="card-pad">
          <p className="text-xs text-slate-500">Receita prevista</p>
          <p className="text-xl font-semibold text-slate-900">
            {brl(roster.reduce((a, e) => a + (e.price - e.discount), 0))}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {brl(klass.price ?? course?.price ?? 0)} por aluno
          </p>
        </div>
      </div>

      <div className="card-pad">
        <ShareLink
          url={enrollUrl}
          title="Link de inscricao desta turma"
          description="Compartilhe com os interessados. As inscricoes caem direto no CRM."
          whatsappMessage={`Inscricoes abertas para ${klass.name}! Garanta sua vaga: ${enrollUrl}`}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "alunos", label: "Alunos", count: roster.length },
          { id: "aulas", label: "Aulas", count: sessions.length },
          { id: "frequencia", label: "Mapa de frequencia" },
        ]}
      />

      {tab === "alunos" && (
        <div className="card overflow-hidden">
          {roster.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Aluno</th>
                    <th className="th">Situacao</th>
                    <th className="th">Valor</th>
                    <th className="th w-44">Frequencia</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roster.map((e) => {
                    const c = data.contacts.find((x) => x.id === e.contactId);
                    const stat = attendanceRate(data, e.contactId, klass.id);
                    const ok = stat.rate >= klass.minAttendancePct / 100;
                    return (
                      <tr key={e.id} className="row-hover">
                        <td className="td">
                          <Link href={`/contatos/${e.contactId}`} className="flex items-center gap-2.5">
                            <Avatar name={c?.name || "?"} size={30} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-800 hover:text-indigo-700">
                                {c?.name}
                              </span>
                              <span className="block truncate text-xs text-slate-500">{c?.email}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="td">
                          <Select
                            className="w-auto py-1 text-[13px]"
                            value={e.status}
                            onChange={(ev) =>
                              mutate({
                                type: "enroll.status",
                                id: e.id,
                                status: ev.target.value as typeof e.status,
                              })
                            }
                          >
                            <option value="pre-inscrito">Pre-inscrito</option>
                            <option value="matriculado">Matriculado</option>
                            <option value="concluido">Concluido</option>
                            <option value="trancado">Trancado</option>
                            <option value="cancelado">Cancelado</option>
                          </Select>
                        </td>
                        <td className="td">{brl(e.price - e.discount)}</td>
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={stat.rate} color={ok ? "#16a34a" : "#dc2626"} />
                            <span
                              className={`w-10 shrink-0 text-right text-xs font-semibold ${ok ? "text-emerald-600" : "text-rose-600"}`}
                            >
                              {pct(stat.rate)}
                            </span>
                          </div>
                        </td>
                        <td className="td text-right">
                          <ConfirmButton
                            message="Remover este aluno da turma?"
                            onConfirm={() =>
                              mutate({ type: "remove", collection: "enrollments", id: e.id })
                            }
                          >
                            Remover
                          </ConfirmButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhum aluno matriculado"
              description="Adicione manualmente ou compartilhe o link de inscricao."
              action={
                <button className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>
                  Adicionar aluno
                </button>
              }
            />
          )}
        </div>
      )}

      {tab === "aulas" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost btn-sm"
              onClick={async () => {
                const [res] = (await mutate({ type: "sessions.generate", classId: klass.id })) as [
                  { created: number },
                ];
                toast(`${res.created} aulas geradas.`);
              }}
            >
              Gerar aulas pelo calendario
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={() =>
                setSessionEdit({
                  date: todayISO(),
                  startTime: klass.startTime,
                  endTime: klass.endTime,
                  topic: "",
                  teacher: klass.teacher,
                  status: "agendada",
                })
              }
            >
              Nova aula
            </button>
          </div>

          <div className="card overflow-hidden">
            {sessions.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="th">Data</th>
                      <th className="th">Conteudo</th>
                      <th className="th">Horario</th>
                      <th className="th">Situacao</th>
                      <th className="th">Presencas</th>
                      <th className="th"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map((s) => {
                      const records = data.attendance.filter((a) => a.sessionId === s.id);
                      const present = records.filter((a) =>
                        ["presente", "atrasado", "justificado"].includes(a.status),
                      ).length;
                      return (
                        <tr key={s.id} className="row-hover">
                          <td className="td whitespace-nowrap font-medium text-slate-800">
                            {fmtDate(s.date)}
                          </td>
                          <td className="td">{s.topic || "-"}</td>
                          <td className="td whitespace-nowrap text-slate-600">
                            {s.startTime} - {s.endTime}
                          </td>
                          <td className="td">
                            <Badge
                              tone={
                                s.status === "realizada"
                                  ? "green"
                                  : s.status === "cancelada"
                                    ? "red"
                                    : "slate"
                              }
                            >
                              {s.status}
                            </Badge>
                            {s.checkinOpen && <Badge tone="amber">check-in aberto</Badge>}
                          </td>
                          <td className="td text-slate-600">
                            {present}/{roster.length}
                          </td>
                          <td className="td">
                            <div className="flex justify-end gap-1.5">
                              <Link href={`/presenca?aula=${s.id}`} className="btn-sub btn-sm">
                                Chamada
                              </Link>
                              <button className="btn-ghost btn-sm" onClick={() => setShareSession(s)}>
                                Check-in
                              </button>
                              <button className="btn-ghost btn-sm" onClick={() => setSessionEdit(s)}>
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
                title="Nenhuma aula cadastrada"
                description="Gere as aulas automaticamente a partir dos dias da semana da turma."
              />
            )}
          </div>
        </div>
      )}

      {tab === "frequencia" && (
        <div className="card overflow-hidden">
          {roster.length && sessions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th sticky left-0 bg-slate-50">Aluno</th>
                    {sessions.map((s) => (
                      <th key={s.id} className="th whitespace-nowrap text-center" title={s.topic}>
                        {s.date.slice(8, 10)}/{s.date.slice(5, 7)}
                      </th>
                    ))}
                    <th className="th text-center">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roster.map((e) => {
                    const c = data.contacts.find((x) => x.id === e.contactId);
                    const stat = attendanceRate(data, e.contactId, klass.id);
                    return (
                      <tr key={e.id} className="row-hover">
                        <td className="td sticky left-0 whitespace-nowrap bg-white font-medium">
                          {c?.name}
                        </td>
                        {sessions.map((s) => {
                          const rec = data.attendance.find(
                            (a) => a.sessionId === s.id && a.contactId === e.contactId,
                          );
                          const label = rec?.status || (s.status === "realizada" ? "falta" : "");
                          const map: Record<string, string> = {
                            presente: "bg-emerald-500",
                            atrasado: "bg-amber-500",
                            justificado: "bg-sky-500",
                            falta: "bg-rose-500",
                            "": "bg-slate-200",
                          };
                          return (
                            <td key={s.id} className="td text-center">
                              <span
                                title={`${fmtDate(s.date)}: ${label || "nao lancado"}`}
                                className={`inline-block h-4 w-4 rounded ${map[label]}`}
                              />
                            </td>
                          );
                        })}
                        <td className="td text-center font-semibold">{pct(stat.rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
                {[
                  ["bg-emerald-500", "presente"],
                  ["bg-amber-500", "atrasado"],
                  ["bg-sky-500", "justificado"],
                  ["bg-rose-500", "falta"],
                  ["bg-slate-200", "nao lancado"],
                ].map(([cls, label]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded ${cls}`} /> {label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="Sem dados" description="Cadastre alunos e aulas para ver o mapa." />
          )}
        </div>
      )}

      {/* Adicionar aluno */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Adicionar aluno a turma"
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setAddOpen(false)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!addContactId) return toast("Escolha um contato.", "erro");
                await mutate({
                  type: "enroll.create",
                  contactId: addContactId,
                  classId: klass.id,
                  generatePayments: false,
                });
                setAddOpen(false);
                setAddContactId("");
                toast("Aluno matriculado.");
              }}
            >
              Matricular
            </button>
          </>
        }
      >
        <Field label="Contato" hint="Nao encontrou? Cadastre em Contatos e volte aqui.">
          <Select value={addContactId} onChange={(e) => setAddContactId(e.target.value)}>
            <option value="">Selecione...</option>
            {data.contacts
              .filter((c) => !c.archived && !roster.some((r) => r.contactId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.email ? `(${c.email})` : ""}
                </option>
              ))}
          </Select>
        </Field>
      </Modal>

      {/* Editar aula */}
      <Modal
        open={!!sessionEdit}
        onClose={() => setSessionEdit(null)}
        title={sessionEdit?.id ? "Editar aula" : "Nova aula"}
        footer={
          <>
            {sessionEdit?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                message="Excluir esta aula e as presencas lancadas?"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "sessions", id: sessionEdit.id! });
                  setSessionEdit(null);
                  toast("Aula excluida.");
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setSessionEdit(null)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={saveSession}>
              Salvar
            </button>
          </>
        }
      >
        {sessionEdit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data">
              <Input
                type="date"
                value={sessionEdit.date || ""}
                onChange={(e) => setSessionEdit({ ...sessionEdit, date: e.target.value })}
              />
            </Field>
            <Field label="Situacao">
              <Select
                value={sessionEdit.status || "agendada"}
                onChange={(e) =>
                  setSessionEdit({ ...sessionEdit, status: e.target.value as ClassSession["status"] })
                }
              >
                <option value="agendada">Agendada</option>
                <option value="realizada">Realizada</option>
                <option value="cancelada">Cancelada</option>
              </Select>
            </Field>
            <Field label="Inicio">
              <Input
                type="time"
                value={sessionEdit.startTime || ""}
                onChange={(e) => setSessionEdit({ ...sessionEdit, startTime: e.target.value })}
              />
            </Field>
            <Field label="Termino">
              <Input
                type="time"
                value={sessionEdit.endTime || ""}
                onChange={(e) => setSessionEdit({ ...sessionEdit, endTime: e.target.value })}
              />
            </Field>
            <Field label="Conteudo da aula" className="sm:col-span-2">
              <Input
                value={sessionEdit.topic || ""}
                onChange={(e) => setSessionEdit({ ...sessionEdit, topic: e.target.value })}
              />
            </Field>
            <Field label="Professor" className="sm:col-span-2">
              <Input
                value={sessionEdit.teacher || ""}
                onChange={(e) => setSessionEdit({ ...sessionEdit, teacher: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Check-in da aula */}
      <Modal
        open={!!shareSession}
        onClose={() => setShareSession(null)}
        title="Check-in do aluno (QR code)"
        wide
        footer={
          <button className="btn-primary btn-sm" onClick={() => setShareSession(null)}>
            Fechar
          </button>
        }
      >
        {shareSession && (
          <div className="space-y-4">
            <ShareLink
              url={`${baseUrl}/checkin/${shareSession.checkinToken}`}
              title={`Check-in - ${fmtDate(shareSession.date)}`}
              description="Projete o QR code na sala. O aluno confirma a presenca com o e-mail ou telefone do cadastro."
              whatsappMessage={`Confirme sua presenca na aula de hoje: ${baseUrl}/checkin/${shareSession.checkinToken}`}
            />
            <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={shareSession.checkinOpen}
                onChange={async (e) => {
                  await mutate({
                    type: "session.checkin",
                    id: shareSession.id,
                    open: e.target.checked,
                  });
                  setShareSession({ ...shareSession, checkinOpen: e.target.checked });
                }}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Check-in aberto (o aluno so consegue registrar presenca com isso ligado)
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
