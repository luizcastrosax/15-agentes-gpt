"use client";

import { useMemo } from "react";
import { useCrm } from "@/components/DataProvider";
import { BarChart, DonutChart, FunnelChart, HBarChart, ProgressBar } from "@/components/charts";
import { PageHeader, Stat } from "@/components/ui";
import { brl, downloadFile, pct, toCSV, todayISO } from "@/lib/shared";
import {
  classAttendanceRate,
  conversionRate,
  dashboardStats,
  dealsByStage,
  monthlySeries,
  rosterOf,
  sourcePerformance,
  studentsAtRisk,
} from "@/lib/selectors";

export default function ReportsPage() {
  const { data } = useCrm();
  const stats = useMemo(() => dashboardStats(data), [data]);
  const series = useMemo(() => monthlySeries(data, 12), [data]);
  const sources = useMemo(() => sourcePerformance(data), [data]);
  const risk = useMemo(() => studentsAtRisk(data), [data]);

  const funnel = useMemo(
    () =>
      dealsByStage(data).map((g) => ({
        label: g.stage.name,
        value: g.deals.length,
        color: g.stage.color,
      })),
    [data],
  );

  const lostReasons = useMemo(() => {
    const map = new Map<string, number>();
    data.deals
      .filter((d) => d.status === "perdido")
      .forEach((d) => map.set(d.lostReason || "Nao informado", (map.get(d.lostReason || "Nao informado") || 0) + 1));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [data.deals]);

  const classRows = useMemo(
    () =>
      data.classes.map((c) => {
        const roster = rosterOf(data, c.id);
        const revenue = roster.reduce((a, e) => a + (e.price - e.discount), 0);
        return {
          klass: c,
          course: data.courses.find((x) => x.id === c.courseId)?.name || "-",
          students: roster.length,
          occupancy: c.capacity ? roster.length / c.capacity : 0,
          attendance: classAttendanceRate(data, c.id),
          revenue,
        };
      }),
    [data],
  );

  const courseRevenue = useMemo(
    () =>
      data.courses
        .map((course) => {
          const classIds = data.classes.filter((c) => c.courseId === course.id).map((c) => c.id);
          const value = data.enrollments
            .filter((e) => classIds.includes(e.classId) && e.status !== "cancelado")
            .reduce((a, e) => a + (e.price - e.discount), 0);
          return { label: course.name, value };
        })
        .sort((a, b) => b.value - a.value),
    [data],
  );

  function exportAll() {
    downloadFile(
      `relatorio-turmas-${todayISO()}.csv`,
      toCSV(
        classRows.map((r) => ({
          Turma: r.klass.name,
          Curso: r.course,
          Professor: r.klass.teacher,
          Situacao: r.klass.status,
          Alunos: r.students,
          Vagas: r.klass.capacity,
          Ocupacao: pct(r.occupancy),
          Frequencia: pct(r.attendance),
          "Receita prevista": r.revenue,
        })),
      ),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Relatorios"
        subtitle="Desempenho comercial, academico e financeiro"
        actions={
          <button className="btn-ghost btn-sm" onClick={exportAll}>
            Exportar turmas (CSV)
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Taxa de conversao" value={pct(conversionRate(data))} tone="green" />
        <Stat label="Ticket medio" value={brl(
          data.enrollments.length
            ? data.enrollments.reduce((a, e) => a + (e.price - e.discount), 0) / data.enrollments.length
            : 0,
        )} tone="indigo" />
        <Stat label="Frequencia geral" value={pct(stats.globalAttendance)} tone="blue" />
        <Stat label="Alunos em risco" value={String(risk.length)} tone={risk.length ? "red" : "slate"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">
            Matriculas nos ultimos 12 meses
          </h2>
          <BarChart data={series.map((s) => ({ label: s.label, value: s.enrollments }))} />
        </div>
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">
            Receita recebida nos ultimos 12 meses
          </h2>
          <BarChart
            data={series.map((s) => ({ label: s.label, value: s.revenue }))}
            format={(v) => brl(v)}
            color="#16a34a"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Funil por etapa</h2>
          <FunnelChart data={funnel} />
        </div>
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Motivos de perda</h2>
          {lostReasons.length ? (
            <HBarChart data={lostReasons} color="#dc2626" />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Nenhum negocio perdido ainda.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-pad lg:col-span-2">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Desempenho por origem</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="th">Origem</th>
                  <th className="th text-right">Contatos</th>
                  <th className="th text-right">Viraram alunos</th>
                  <th className="th text-right">Conversao</th>
                  <th className="th text-right">Receita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((s) => (
                  <tr key={s.source} className="row-hover">
                    <td className="td font-medium text-slate-800">{s.source}</td>
                    <td className="td text-right">{s.leads}</td>
                    <td className="td text-right">{s.students}</td>
                    <td className="td text-right">{pct(s.leads ? s.students / s.leads : 0)}</td>
                    <td className="td text-right">{brl(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Receita por curso</h2>
          <HBarChart data={courseRevenue} format={(v) => brl(v)} />
        </div>
      </div>

      <div className="card-pad">
        <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Desempenho das turmas</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Turma</th>
                <th className="th">Curso</th>
                <th className="th text-right">Alunos</th>
                <th className="th w-36">Ocupacao</th>
                <th className="th w-36">Frequencia</th>
                <th className="th text-right">Receita prevista</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classRows.map((r) => (
                <tr key={r.klass.id} className="row-hover">
                  <td className="td font-medium text-slate-800">{r.klass.name}</td>
                  <td className="td text-slate-600">{r.course}</td>
                  <td className="td text-right">
                    {r.students}/{r.klass.capacity}
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={r.occupancy} />
                      <span className="w-9 text-right text-xs">{pct(r.occupancy)}</span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={r.attendance}
                        color={r.attendance >= r.klass.minAttendancePct / 100 ? "#16a34a" : "#f59e0b"}
                      />
                      <span className="w-9 text-right text-xs">{pct(r.attendance)}</span>
                    </div>
                  </td>
                  <td className="td text-right font-medium">{brl(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Situacao financeira</h2>
          <DonutChart
            data={[
              { label: "Recebido", value: Math.round(stats.finance.received), color: "#16a34a" },
              { label: "A receber", value: Math.round(stats.finance.pendingAmount), color: "#f59e0b" },
              { label: "Em atraso", value: Math.round(stats.finance.overdueAmount), color: "#dc2626" },
            ]}
            centerValue={brl(
              stats.finance.received + stats.finance.pendingAmount + stats.finance.overdueAmount,
            )}
            centerLabel="total"
          />
        </div>
        <div className="card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Alunos com menor frequencia</h2>
          {risk.length ? (
            <HBarChart
              data={risk.slice(0, 8).map((r) => ({ label: r.contact.name, value: Math.round(r.rate * 100) }))}
              format={(v) => `${v}%`}
              color="#dc2626"
            />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              Todos os alunos estao acima da frequencia minima.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
