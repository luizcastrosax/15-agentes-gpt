"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCrm } from "@/components/DataProvider";
import { BarChart, DonutChart, FunnelChart, ProgressBar } from "@/components/charts";
import { Avatar, Badge, PageHeader, Stat } from "@/components/ui";
import { brl, fmtDate, pct, todayISO } from "@/lib/shared";
import {
  attendanceRate,
  dashboardStats,
  dealsByStage,
  monthlySeries,
  overdueActivities,
  studentsAtRisk,
  todayActivities,
} from "@/lib/selectors";

export default function DashboardPage() {
  const { data, user, mutate } = useCrm();
  const stats = useMemo(() => dashboardStats(data), [data]);
  const series = useMemo(() => monthlySeries(data, 6), [data]);
  const risk = useMemo(() => studentsAtRisk(data).slice(0, 5), [data]);
  const today = todayISO();

  const upcoming = useMemo(
    () =>
      data.sessions
        .filter((s) => s.date >= today && s.status !== "cancelada")
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5),
    [data, today],
  );

  const tasks = useMemo(
    () =>
      [...overdueActivities(data), ...todayActivities(data)]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 6),
    [data],
  );

  const funnel = useMemo(
    () =>
      dealsByStage(data)
        .filter((g) => g.stage.kind === "open")
        .map((g) => ({
          label: g.stage.name,
          value: g.deals.length,
          color: g.stage.color,
        })),
    [data],
  );

  const statusMix = useMemo(() => {
    const counts = { lead: 0, aluno: 0, "ex-aluno": 0, inativo: 0 };
    data.contacts.filter((c) => !c.archived).forEach((c) => (counts[c.status] += 1));
    return [
      { label: "Leads", value: counts.lead, color: "#0ea5e9" },
      { label: "Alunos ativos", value: counts.aluno, color: "#16a34a" },
      { label: "Ex-alunos", value: counts["ex-aluno"], color: "#8b5cf6" },
      { label: "Inativos", value: counts.inativo, color: "#94a3b8" },
    ];
  }, [data]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}!`}
        subtitle={`Visao geral de ${data.org.name} em ${fmtDate(today)}`}
        actions={
          <>
            <Link href="/contatos?novo=1" className="btn-ghost btn-sm">
              Novo contato
            </Link>
            <Link href="/turmas" className="btn-primary btn-sm">
              Compartilhar inscricao
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Alunos ativos"
          value={String(stats.activeStudents)}
          hint={`${stats.enrollmentsThisMonth} matriculas este mes`}
          tone="green"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
            </svg>
          }
        />
        <Stat
          label="Leads em aberto"
          value={String(stats.leads)}
          hint={`${stats.newLeadsThisMonth} novos este mes`}
          tone="blue"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 12h4l3 8 4-16 3 8h4" />
            </svg>
          }
        />
        <Stat
          label="Frequencia media"
          value={pct(stats.globalAttendance)}
          hint={`${risk.length ? `${risk.length} alunos em risco` : "Nenhum aluno em risco"}`}
          tone={stats.globalAttendance >= 0.75 ? "green" : "amber"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 11.5 11.5 14 16 8.5" />
              <rect x="3" y="4" width="18" height="17" rx="2.5" />
            </svg>
          }
        />
        <Stat
          label="Receita recebida (mes)"
          value={brl(stats.finance.receivedThisMonth)}
          hint={`${brl(stats.finance.overdueAmount)} em atraso`}
          tone={stats.finance.overdueCount ? "amber" : "indigo"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="6" width="18" height="13" rx="2.5" />
              <path d="M3 10h18" />
            </svg>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-pad lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">Matriculas por mes</h2>
              <p className="text-xs text-slate-500">Ultimos 6 meses</p>
            </div>
            <Link href="/relatorios" className="link text-[13px]">
              Ver relatorios
            </Link>
          </div>
          <BarChart data={series.map((s) => ({ label: s.label, value: s.enrollments }))} />
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
            <div>
              <p className="text-xs text-slate-500">Pipeline aberto</p>
              <p className="text-sm font-semibold text-slate-900">{brl(stats.pipeline)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Previsao ponderada</p>
              <p className="text-sm font-semibold text-slate-900">{brl(stats.weighted)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Taxa de conversao</p>
              <p className="text-sm font-semibold text-slate-900">{pct(stats.conversion)}</p>
            </div>
          </div>
        </div>

        <div className="card-pad">
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900">Base de contatos</h2>
          <DonutChart
            data={statusMix}
            centerValue={String(data.contacts.filter((c) => !c.archived).length)}
            centerLabel="contatos"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-pad">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-slate-900">Funil de vendas</h2>
            <Link href="/funil" className="link text-[13px]">
              Abrir
            </Link>
          </div>
          {funnel.some((f) => f.value > 0) ? (
            <FunnelChart data={funnel} />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Nenhum negocio em aberto.</p>
          )}
        </div>

        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-slate-900">Proximas aulas</h2>
            <Link href="/presenca" className="link text-[13px]">
              Fazer chamada
            </Link>
          </div>
          {upcoming.length ? (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((s) => {
                const klass = data.classes.find((c) => c.id === s.classId);
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                      <span className="text-[13px] font-bold leading-none">{s.date.slice(8, 10)}</span>
                      <span className="text-[9px] uppercase">
                        {new Date(`${s.date}T12:00:00`)
                          .toLocaleDateString("pt-BR", { month: "short" })
                          .replace(".", "")}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-slate-800">{s.topic}</p>
                      <p className="truncate text-xs text-slate-500">
                        {klass?.name} - {s.startTime}
                      </p>
                    </div>
                    {s.date === today && <Badge tone="green">hoje</Badge>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma aula agendada.</p>
          )}
        </div>

        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-slate-900">Tarefas do dia</h2>
            <Link href="/tarefas" className="link text-[13px]">
              Ver todas
            </Link>
          </div>
          {tasks.length ? (
            <ul className="divide-y divide-slate-100">
              {tasks.map((a) => {
                const contact = data.contacts.find((c) => c.id === a.contactId);
                const late = a.dueDate < today;
                return (
                  <li key={a.id} className="flex items-start gap-2.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={a.done}
                      onChange={() => mutate({ type: "activity.toggle", id: a.id })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-slate-800">{a.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {contact ? `${contact.name} - ` : ""}
                        <span className={late ? "font-medium text-rose-600" : ""}>
                          {fmtDate(a.dueDate)}
                        </span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Tudo em dia por aqui.</p>
          )}
        </div>
      </div>

      {risk.length > 0 && (
        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">Alunos em risco de evasao</h2>
              <p className="text-xs text-slate-500">Frequencia abaixo do minimo da turma</p>
            </div>
            <Link href="/presenca" className="link text-[13px]">
              Ver presenca
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="th">Aluno</th>
                  <th className="th">Turma</th>
                  <th className="th">Faltas</th>
                  <th className="th w-40">Frequencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {risk.map((r, i) => (
                  <tr key={i} className="row-hover">
                    <td className="td">
                      <Link href={`/contatos/${r.contact.id}`} className="flex items-center gap-2">
                        <Avatar name={r.contact.name} size={28} />
                        <span className="font-medium text-slate-800 hover:text-indigo-700">
                          {r.contact.name}
                        </span>
                      </Link>
                    </td>
                    <td className="td text-slate-600">{r.klass.name}</td>
                    <td className="td">
                      <Badge tone="red">{r.absences} faltas</Badge>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          value={r.rate}
                          color={r.rate < 0.5 ? "#dc2626" : "#f59e0b"}
                        />
                        <span className="w-10 shrink-0 text-right text-xs font-medium text-slate-700">
                          {pct(r.rate)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
