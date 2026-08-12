import type {
  Attendance,
  Contact,
  CourseClass,
  CrmData,
  Deal,
  Enrollment,
  Payment,
} from "./types";
import { todayISO, sum } from "./shared";

export const PRESENT_STATES: Attendance["status"][] = ["presente", "atrasado", "justificado"];

export function contactById(data: CrmData, id: string): Contact | undefined {
  return data.contacts.find((c) => c.id === id);
}

export function classById(data: CrmData, id: string): CourseClass | undefined {
  return data.classes.find((c) => c.id === id);
}

export function courseOfClass(data: CrmData, classId: string) {
  const klass = classById(data, classId);
  return klass ? data.courses.find((c) => c.id === klass.courseId) : undefined;
}

export function classLabel(data: CrmData, classId: string): string {
  const klass = classById(data, classId);
  if (!klass) return "-";
  return klass.name;
}

export function classPrice(data: CrmData, klass: CourseClass): number {
  if (klass.price !== null && klass.price !== undefined) return klass.price;
  return data.courses.find((c) => c.id === klass.courseId)?.price || 0;
}

/** Alunos ativos de uma turma. */
export function rosterOf(data: CrmData, classId: string): Enrollment[] {
  return data.enrollments.filter(
    (e) => e.classId === classId && ["matriculado", "pre-inscrito"].includes(e.status),
  );
}

export function seatsLeft(data: CrmData, klass: CourseClass): number {
  const taken = data.enrollments.filter(
    (e) => e.classId === klass.id && e.status !== "cancelado",
  ).length;
  return Math.max(0, (klass.capacity || 0) - taken);
}

/** Frequencia de um aluno em uma turma, considerando somente aulas realizadas. */
export function attendanceRate(
  data: CrmData,
  contactId: string,
  classId: string,
): { rate: number; present: number; held: number; absences: number } {
  const sessions = data.sessions.filter((s) => s.classId === classId && s.status === "realizada");
  const ids = new Set(sessions.map((s) => s.id));
  const records = data.attendance.filter((a) => a.contactId === contactId && ids.has(a.sessionId));
  const present = records.filter((a) => PRESENT_STATES.includes(a.status)).length;
  const absences = sessions.length - present;
  return {
    rate: sessions.length ? present / sessions.length : 1,
    present,
    held: sessions.length,
    absences: Math.max(0, absences),
  };
}

/** Frequencia media da turma. */
export function classAttendanceRate(data: CrmData, classId: string): number {
  const roster = rosterOf(data, classId);
  if (!roster.length) return 1;
  const rates = roster.map((e) => attendanceRate(data, e.contactId, classId).rate);
  return sum(rates) / rates.length;
}

/** Alunos em risco: frequencia abaixo do minimo da turma. */
export function studentsAtRisk(data: CrmData): Array<{
  contact: Contact;
  klass: CourseClass;
  rate: number;
  absences: number;
}> {
  const out: Array<{ contact: Contact; klass: CourseClass; rate: number; absences: number }> = [];
  for (const klass of data.classes) {
    const held = data.sessions.filter((s) => s.classId === klass.id && s.status === "realizada");
    if (!held.length) continue;
    for (const e of rosterOf(data, klass.id)) {
      const { rate, absences } = attendanceRate(data, e.contactId, klass.id);
      if (rate < (klass.minAttendancePct || 75) / 100) {
        const contact = contactById(data, e.contactId);
        if (contact) out.push({ contact, klass, rate, absences });
      }
    }
  }
  return out.sort((a, b) => a.rate - b.rate);
}

/* ------------------------------- financeiro ------------------------------- */

export function effectiveStatus(p: Payment): Payment["status"] {
  if (p.status === "pago" || p.status === "cancelado") return p.status;
  return p.dueDate && p.dueDate < todayISO() ? "atrasado" : "pendente";
}

export function financeSummary(data: CrmData) {
  const list = data.payments.filter((p) => p.status !== "cancelado");
  const paid = list.filter((p) => effectiveStatus(p) === "pago");
  const overdue = list.filter((p) => effectiveStatus(p) === "atrasado");
  const pending = list.filter((p) => effectiveStatus(p) === "pendente");
  const month = todayISO().slice(0, 7);
  const paidThisMonth = paid.filter((p) => (p.paidAt || "").slice(0, 7) === month);
  const dueThisMonth = list.filter((p) => p.dueDate.slice(0, 7) === month);
  return {
    received: sum(paid.map((p) => p.amount)),
    receivedThisMonth: sum(paidThisMonth.map((p) => p.amount)),
    dueThisMonth: sum(dueThisMonth.map((p) => p.amount)),
    overdueAmount: sum(overdue.map((p) => p.amount)),
    overdueCount: overdue.length,
    pendingAmount: sum(pending.map((p) => p.amount)),
    pendingCount: pending.length,
  };
}

/* ---------------------------------- funil --------------------------------- */

export function openDeals(data: CrmData): Deal[] {
  return data.deals.filter((d) => d.status === "aberto");
}

export function pipelineValue(data: CrmData): number {
  return sum(openDeals(data).map((d) => d.value));
}

export function weightedPipeline(data: CrmData): number {
  return sum(openDeals(data).map((d) => (d.value * (d.probability || 0)) / 100));
}

export function conversionRate(data: CrmData): number {
  const closed = data.deals.filter((d) => d.status !== "aberto");
  if (!closed.length) return 0;
  return closed.filter((d) => d.status === "ganho").length / closed.length;
}

export function dealsByStage(data: CrmData) {
  const stages = [...data.stages].sort((a, b) => a.order - b.order);
  return stages.map((stage) => ({
    stage,
    deals: data.deals.filter((d) => d.stageId === stage.id && (stage.kind !== "open" ? d.status !== "aberto" : d.status === "aberto")),
  }));
}

/* -------------------------------- atividades ------------------------------ */

export function overdueActivities(data: CrmData) {
  const today = todayISO();
  return data.activities.filter((a) => !a.done && a.dueDate && a.dueDate < today);
}

export function todayActivities(data: CrmData) {
  const today = todayISO();
  return data.activities.filter((a) => !a.done && a.dueDate === today);
}

/* --------------------------------- geral ---------------------------------- */

export function dashboardStats(data: CrmData) {
  const activeStudents = new Set(
    data.enrollments.filter((e) => e.status === "matriculado").map((e) => e.contactId),
  );
  const leads = data.contacts.filter((c) => c.status === "lead" && !c.archived);
  const month = todayISO().slice(0, 7);
  const newLeadsThisMonth = data.contacts.filter(
    (c) => c.createdAt.slice(0, 7) === month,
  ).length;
  const enrollmentsThisMonth = data.enrollments.filter(
    (e) => e.enrolledAt.slice(0, 7) === month,
  ).length;

  const heldSessions = data.sessions.filter((s) => s.status === "realizada");
  const allRecords = data.attendance.filter((a) =>
    heldSessions.some((s) => s.id === a.sessionId),
  );
  const globalAttendance = allRecords.length
    ? allRecords.filter((a) => PRESENT_STATES.includes(a.status)).length / allRecords.length
    : 0;

  return {
    activeStudents: activeStudents.size,
    leads: leads.length,
    newLeadsThisMonth,
    enrollmentsThisMonth,
    openClasses: data.classes.filter((c) => ["aberta", "em-andamento"].includes(c.status)).length,
    globalAttendance,
    pipeline: pipelineValue(data),
    weighted: weightedPipeline(data),
    conversion: conversionRate(data),
    finance: financeSummary(data),
  };
}

/** Origens com contagem e conversao (para relatorios). */
export function sourcePerformance(data: CrmData) {
  const map = new Map<string, { source: string; leads: number; students: number; revenue: number }>();
  for (const c of data.contacts) {
    const key = c.source || "Nao informado";
    const row = map.get(key) || { source: key, leads: 0, students: 0, revenue: 0 };
    row.leads++;
    const enrolled = data.enrollments.filter(
      (e) => e.contactId === c.id && ["matriculado", "concluido"].includes(e.status),
    );
    if (enrolled.length) {
      row.students++;
      row.revenue += sum(
        data.payments
          .filter((p) => p.contactId === c.id && effectiveStatus(p) === "pago")
          .map((p) => p.amount),
      );
    }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

/** Serie mensal de matriculas e receita nos ultimos N meses. */
export function monthlySeries(data: CrmData, months = 6) {
  const out: Array<{ month: string; label: string; enrollments: number; revenue: number }> = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      enrollments: data.enrollments.filter((e) => e.enrolledAt.slice(0, 7) === key).length,
      revenue: sum(
        data.payments
          .filter((p) => p.status === "pago" && (p.paidAt || "").slice(0, 7) === key)
          .map((p) => p.amount),
      ),
    });
  }
  return out;
}
