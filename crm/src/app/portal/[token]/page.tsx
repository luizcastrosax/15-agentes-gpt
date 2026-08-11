"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { brl, fmtDate, pct } from "@/lib/shared";

interface Portal {
  org: { name: string; primaryColor: string; logoText: string; phone: string; email: string };
  student: { name: string; email: string; phone: string };
  courses: {
    enrollmentId: string;
    status: string;
    className: string;
    courseName: string;
    teacher: string;
    location: string;
    startDate: string;
    endDate: string;
    minAttendancePct: number;
    attendanceRate: number;
    sessions: {
      id: string;
      date: string;
      topic: string;
      startTime: string;
      endTime: string;
      status: string;
      attendance: string;
    }[];
  }[];
  payments: { description: string; amount: number; dueDate: string; status: string; paidAt: string }[];
}

const ATT_LABEL: Record<string, { text: string; cls: string }> = {
  presente: { text: "Presente", cls: "bg-emerald-100 text-emerald-700" },
  atrasado: { text: "Atrasado", cls: "bg-amber-100 text-amber-700" },
  justificado: { text: "Justificado", cls: "bg-sky-100 text-sky-700" },
  falta: { text: "Falta", cls: "bg-rose-100 text-rose-700" },
};

export default function PortalPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/portal/${params.token}`)
      .then((r) => r.json())
      .then((json) => (json.error ? setError(json.error) : setData(json)))
      .catch(() => setError("Nao foi possivel carregar o portal."))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card-pad max-w-sm text-center">
          <p className="text-lg font-semibold text-slate-900">Portal indisponivel</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const brand = data.org.primaryColor || "#4f46e5";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: brand }}
          >
            {data.org.logoText || "CRM"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{data.org.name}</p>
            <p className="truncate text-xs text-slate-500">Portal do aluno</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">
        <div className="card-pad">
          <h1 className="text-xl font-semibold text-slate-900">Ola, {data.student.name.split(" ")[0]}!</h1>
          <p className="mt-1 text-sm text-slate-500">
            Aqui voce acompanha suas aulas, frequencia e pagamentos.
          </p>
        </div>

        {data.courses.map((c) => {
          const ok = c.attendanceRate >= c.minAttendancePct / 100;
          return (
            <div key={c.enrollmentId} className="card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-slate-900">{c.courseName}</h2>
                  <p className="text-xs text-slate-500">
                    {c.className} - {c.teacher} - {c.location}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmtDate(c.startDate)} a {fmtDate(c.endDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Sua frequencia</p>
                  <p className={`text-lg font-semibold ${ok ? "text-emerald-600" : "text-rose-600"}`}>
                    {pct(c.attendanceRate)}
                  </p>
                  <p className="text-[11px] text-slate-400">minimo {c.minAttendancePct}%</p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead className="border-b border-slate-200">
                    <tr>
                      <th className="th">Data</th>
                      <th className="th">Aula</th>
                      <th className="th">Horario</th>
                      <th className="th">Presenca</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.sessions.map((s) => {
                      const label =
                        s.attendance || (s.status === "realizada" ? "falta" : "");
                      const meta = ATT_LABEL[label];
                      return (
                        <tr key={s.id} className={s.date === today ? "bg-indigo-50/50" : ""}>
                          <td className="td whitespace-nowrap">{fmtDate(s.date)}</td>
                          <td className="td text-slate-600">{s.topic || "-"}</td>
                          <td className="td whitespace-nowrap text-slate-500">
                            {s.startTime} - {s.endTime}
                          </td>
                          <td className="td">
                            {meta ? (
                              <span className={`chip ${meta.cls}`}>{meta.text}</span>
                            ) : (
                              <span className="text-xs text-slate-400">a realizar</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {!data.courses.length && (
          <div className="card-pad text-center text-sm text-slate-500">
            Voce ainda nao tem matriculas ativas.
          </div>
        )}

        {data.payments.length > 0 && (
          <div className="card-pad">
            <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Meus pagamentos</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px]">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th">Descricao</th>
                    <th className="th">Vencimento</th>
                    <th className="th">Valor</th>
                    <th className="th">Situacao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.payments.map((p, i) => {
                    const overdue = p.status !== "pago" && p.dueDate < today;
                    return (
                      <tr key={i}>
                        <td className="td">{p.description}</td>
                        <td className="td whitespace-nowrap text-slate-600">{fmtDate(p.dueDate)}</td>
                        <td className="td font-medium">{brl(p.amount)}</td>
                        <td className="td">
                          <span
                            className={`chip ${
                              p.status === "pago"
                                ? "bg-emerald-100 text-emerald-700"
                                : overdue
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {p.status === "pago" ? "pago" : overdue ? "em atraso" : "a vencer"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="pb-6 text-center text-xs text-slate-400">
          Duvidas? Fale com {data.org.name}
          {data.org.phone ? ` - ${data.org.phone}` : ""}
          {data.org.email ? ` - ${data.org.email}` : ""}
        </p>
      </main>
    </div>
  );
}
