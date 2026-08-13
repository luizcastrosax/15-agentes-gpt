"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { ShareLink } from "@/components/ShareLink";
import { ProgressBar } from "@/components/charts";
import {
  Avatar,
  Badge,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  useToast,
} from "@/components/ui";
import { downloadFile, fmtDate, pct, toCSV, todayISO } from "@/lib/shared";
import { attendanceRate, rosterOf } from "@/lib/selectors";
import type { AttendanceStatus } from "@/lib/types";

const OPTIONS: { value: AttendanceStatus; label: string; cls: string }[] = [
  { value: "presente", label: "Presente", cls: "bg-emerald-600 border-emerald-600 text-white" },
  { value: "atrasado", label: "Atrasado", cls: "bg-amber-500 border-amber-500 text-white" },
  { value: "justificado", label: "Justificado", cls: "bg-sky-600 border-sky-600 text-white" },
  { value: "falta", label: "Falta", cls: "bg-rose-600 border-rose-600 text-white" },
];

export default function AttendancePage() {
  const { data, mutate, baseUrl } = useCrm();
  const toast = useToast();

  const [classId, setClassId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [checkinOpen, setCheckinOpen] = useState(false);

  const classesWithSessions = useMemo(
    () => data.classes.filter((c) => !["cancelada"].includes(c.status)),
    [data.classes],
  );

  // Selecao inicial: aula da URL, ou aula de hoje, ou a mais proxima.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("aula");
    if (fromUrl) {
      const s = data.sessions.find((x) => x.id === fromUrl);
      if (s) {
        setClassId(s.classId);
        setSessionId(s.id);
        return;
      }
    }
    const today = todayISO();
    const candidate =
      data.sessions.find((s) => s.date === today) ||
      [...data.sessions].filter((s) => s.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0] ||
      data.sessions[0];
    if (candidate) {
      setClassId(candidate.classId);
      setSessionId(candidate.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessions = useMemo(
    () =>
      data.sessions
        .filter((s) => s.classId === classId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.sessions, classId],
  );

  const session = data.sessions.find((s) => s.id === sessionId);
  const klass = data.classes.find((c) => c.id === classId);
  const roster = useMemo(() => (classId ? rosterOf(data, classId) : []), [data, classId]);

  const statusOf = (contactId: string): AttendanceStatus | "" =>
    (data.attendance.find((a) => a.sessionId === sessionId && a.contactId === contactId)
      ?.status as AttendanceStatus) || "";

  const marked = roster.filter((e) => statusOf(e.contactId)).length;
  const present = roster.filter((e) =>
    ["presente", "atrasado", "justificado"].includes(statusOf(e.contactId)),
  ).length;

  async function setStatus(contactId: string, status: AttendanceStatus) {
    if (!sessionId) return;
    await mutate({ type: "attendance.set", sessionId, contactId, status });
  }

  async function fillAll(status: AttendanceStatus) {
    if (!sessionId) return;
    await mutate([
      ...roster.map((e) => ({
        type: "attendance.set" as const,
        sessionId,
        contactId: e.contactId,
        status,
      })),
      {
        type: "upsert" as const,
        collection: "sessions" as const,
        item: { id: sessionId, status: "realizada" },
      },
    ]);
    toast(`Todos marcados como ${status}.`);
  }

  async function closeSession() {
    if (!sessionId) return;
    await mutate([
      { type: "attendance.fill", sessionId, status: "falta" },
      { type: "upsert", collection: "sessions", item: { id: sessionId, status: "realizada" } },
      { type: "session.checkin", id: sessionId, open: false },
    ]);
    toast("Chamada encerrada. Quem nao foi marcado ficou como falta.");
  }

  function exportSession() {
    if (!session) return;
    const rows = roster.map((e) => {
      const c = data.contacts.find((x) => x.id === e.contactId);
      return {
        Aluno: c?.name || "",
        Email: c?.email || "",
        Data: fmtDate(session.date),
        Aula: session.topic,
        Presenca: statusOf(e.contactId) || "nao lancado",
      };
    });
    downloadFile(`chamada-${session.date}.csv`, toCSV(rows));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Controle de presenca"
        subtitle="Faca a chamada em segundos ou libere o check-in por QR code"
        actions={
          session && (
            <>
              <button className="btn-ghost btn-sm" onClick={exportSession}>
                Exportar chamada
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setCheckinOpen(true)}>
                Check-in por QR
              </button>
              <button className="btn-primary btn-sm" onClick={closeSession}>
                Encerrar chamada
              </button>
            </>
          )
        }
      />

      <div className="card-pad grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Turma</label>
          <Select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              const first = data.sessions
                .filter((s) => s.classId === e.target.value)
                .sort((a, b) => b.date.localeCompare(a.date))[0];
              setSessionId(first?.id || "");
            }}
          >
            <option value="">Selecione a turma...</option>
            {classesWithSessions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="label">Aula</label>
          <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={!classId}>
            <option value="">Selecione a aula...</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {fmtDate(s.date)} - {s.topic || "sem tema"} ({s.status})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {session && klass ? (
        <>
          <div className="card-pad">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">
                  {fmtDate(session.date)} - {session.topic || "Aula"}
                </h2>
                <p className="text-xs text-slate-500">
                  {klass.name} - {session.startTime} as {session.endTime} - {session.teacher}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={session.status === "realizada" ? "green" : "slate"}>
                  {session.status}
                </Badge>
                {session.checkinOpen && <Badge tone="amber">check-in aberto</Badge>}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="min-w-[180px] flex-1">
                <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                  <span>
                    {marked}/{roster.length} lancados - {present} presentes
                  </span>
                  <span>{pct(roster.length ? present / roster.length : 0)}</span>
                </div>
                <ProgressBar value={roster.length ? marked / roster.length : 0} />
              </div>
              <div className="flex gap-1.5">
                <button className="btn-sub btn-sm" onClick={() => fillAll("presente")}>
                  Todos presentes
                </button>
                <button className="btn-sub btn-sm" onClick={() => fillAll("falta")}>
                  Todos ausentes
                </button>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            {roster.length ? (
              <ul className="divide-y divide-slate-100">
                {roster.map((e) => {
                  const c = data.contacts.find((x) => x.id === e.contactId);
                  const current = statusOf(e.contactId);
                  const stat = attendanceRate(data, e.contactId, classId);
                  const record = data.attendance.find(
                    (a) => a.sessionId === sessionId && a.contactId === e.contactId,
                  );
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Avatar name={c?.name || "?"} size={36} />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/contatos/${e.contactId}`}
                          className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700"
                        >
                          {c?.name}
                        </Link>
                        <p className="truncate text-xs text-slate-500">
                          Frequencia geral: {pct(stat.rate)} ({stat.present}/{stat.held})
                          {record?.method === "autocheckin" && " - check-in pelo aluno"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => setStatus(e.contactId, o.value)}
                            className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                              current === o.value
                                ? o.cls
                                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                title="Turma sem alunos"
                description="Matricule alunos para fazer a chamada."
                action={
                  <Link href={`/turmas/${classId}`} className="btn-primary btn-sm">
                    Abrir turma
                  </Link>
                }
              />
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <EmptyState
            title="Selecione uma turma e uma aula"
            description="Escolha acima para comecar a chamada."
          />
        </div>
      )}

      <Modal
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        title="Check-in do aluno por QR code"
        wide
        footer={
          <button className="btn-primary btn-sm" onClick={() => setCheckinOpen(false)}>
            Fechar
          </button>
        }
      >
        {session && (
          <div className="space-y-4">
            <ShareLink
              url={`${baseUrl}/checkin/${session.checkinToken}`}
              title={`Check-in - ${fmtDate(session.date)}`}
              description="Projete o QR na sala. O aluno confirma com o e-mail ou telefone do cadastro."
              whatsappMessage={`Confirme sua presenca na aula de hoje: ${baseUrl}/checkin/${session.checkinToken}`}
            />
            <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={session.checkinOpen}
                onChange={(e) =>
                  mutate({ type: "session.checkin", id: session.id, open: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Check-in aberto
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
