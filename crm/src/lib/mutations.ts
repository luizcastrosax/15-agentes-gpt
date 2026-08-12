import type {
  Attendance,
  Collection,
  Contact,
  CrmData,
  Enrollment,
  Payment,
  User,
} from "./types";
import { hashPassword, nowISO, token, uid } from "./utils";

export type Action =
  | { type: "upsert"; collection: Collection; item: Record<string, unknown> }
  | { type: "remove"; collection: Collection; id: string }
  | { type: "settings.org"; org: Partial<CrmData["org"]> }
  | { type: "settings.form"; form: Partial<CrmData["form"]> }
  | { type: "settings.lists"; sources?: string[]; lostReasons?: string[] }
  | { type: "stages.reorder"; ids: string[] }
  | { type: "contacts.import"; rows: Record<string, string>[] }
  | { type: "contacts.bulk"; ids: string[]; op: string; value?: string }
  | { type: "deal.move"; id: string; stageId: string }
  | { type: "deal.close"; id: string; status: "ganho" | "perdido"; lostReason?: string }
  | {
      type: "enroll.create";
      contactId: string;
      classId: string;
      price?: number;
      discount?: number;
      installments?: number;
      paymentMethod?: string;
      status?: Enrollment["status"];
      generatePayments?: boolean;
      firstDueDate?: string;
    }
  | { type: "enroll.status"; id: string; status: Enrollment["status"] }
  | { type: "sessions.generate"; classId: string; replaceFuture?: boolean }
  | { type: "session.checkin"; id: string; open: boolean }
  | { type: "class.rotateToken"; id: string }
  | { type: "attendance.set"; sessionId: string; contactId: string; status: Attendance["status"]; note?: string }
  | { type: "attendance.fill"; sessionId: string; status: Attendance["status"] }
  | { type: "payments.generate"; enrollmentId: string; firstDueDate: string; installments: number }
  | { type: "payment.pay"; id: string; paidAt: string; method?: string }
  | { type: "payment.unpay"; id: string }
  | { type: "note.add"; contactId: string; body: string; authorId: string }
  | { type: "activity.toggle"; id: string }
  | { type: "user.create"; name: string; email: string; role: User["role"]; password: string }
  | { type: "user.password"; id: string; password: string }
  | { type: "timeline.add"; contactId: string; message: string; kind?: string };

export interface ActionContext {
  actor: string;
}

function logEvent(data: CrmData, message: string, contactId = "", actor = "sistema", type = "geral") {
  data.timeline.unshift({
    id: uid("ev"),
    type,
    contactId,
    message,
    meta: {},
    actor,
    createdAt: nowISO(),
  });
  if (data.timeline.length > 800) data.timeline.length = 800;
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(`${(iso || nowISO()).slice(0, 10)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function emptyContact(partial: Partial<Contact> = {}): Contact {
  return {
    id: uid("contact"),
    name: "",
    email: "",
    phone: "",
    document: "",
    birthDate: "",
    company: "",
    jobTitle: "",
    city: "",
    state: "",
    address: "",
    zip: "",
    source: "",
    status: "lead",
    ownerId: "",
    tagIds: [],
    custom: {},
    notes: "",
    optInEmail: true,
    optInWhatsapp: true,
    lgpdConsentAt: "",
    portalToken: token(12),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    archived: false,
    ...partial,
  };
}

export function buildInstallments(
  enrollment: Enrollment,
  firstDueDate: string,
  installments: number,
): Payment[] {
  const total = Math.max(0, (enrollment.price || 0) - (enrollment.discount || 0));
  const n = Math.max(1, installments || 1);
  const base = Math.floor((total / n) * 100) / 100;
  const rest = Math.round((total - base * n) * 100) / 100;
  const out: Payment[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: uid("pay"),
      contactId: enrollment.contactId,
      enrollmentId: enrollment.id,
      description: `Parcela ${i + 1}/${n}`,
      amount: i === n - 1 ? Math.round((base + rest) * 100) / 100 : base,
      dueDate: addMonthsISO(firstDueDate, i),
      paidAt: "",
      method: enrollment.paymentMethod || "",
      status: "pendente",
      installment: i + 1,
      installments: n,
      createdAt: nowISO(),
    });
  }
  return out;
}

/** Gera as datas de aula de uma turma a partir dos dias da semana configurados. */
export function generateSessionDates(
  startDate: string,
  endDate: string,
  weekDays: number[],
): string[] {
  if (!startDate || !endDate || !weekDays.length) return [];
  const out: string[] = [];
  const cur = new Date(`${startDate.slice(0, 10)}T12:00:00`);
  const end = new Date(`${endDate.slice(0, 10)}T12:00:00`);
  let guard = 0;
  while (cur <= end && guard < 500) {
    if (weekDays.includes(cur.getDay())) out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function applyAction(data: CrmData, action: Action, ctx: ActionContext): unknown {
  const actor = ctx.actor || "sistema";

  switch (action.type) {
    case "upsert": {
      const list = data[action.collection] as any[];
      const item = { ...action.item } as any;
      const idx = item.id ? list.findIndex((x) => x.id === item.id) : -1;
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...item, updatedAt: nowISO() };
        return list[idx];
      }
      if (!item.id) item.id = uid(action.collection.slice(0, 4));
      if (!item.createdAt) item.createdAt = nowISO();
      if (action.collection === "contacts") {
        const full = emptyContact(item);
        list.push(full);
        logEvent(data, `Contato criado: ${full.name}`, full.id, actor, "contato");
        return full;
      }
      if (action.collection === "classes" && !item.enrollToken) item.enrollToken = token(10);
      if (action.collection === "sessions" && !item.checkinToken) item.checkinToken = token(10);
      list.push(item);
      return item;
    }

    case "remove": {
      const list = data[action.collection] as any[];
      const idx = list.findIndex((x) => x.id === action.id);
      if (idx < 0) return null;
      const [removed] = list.splice(idx, 1);
      // Limpezas em cascata
      if (action.collection === "contacts") {
        data.enrollments = data.enrollments.filter((e) => e.contactId !== action.id);
        data.attendance = data.attendance.filter((a) => a.contactId !== action.id);
        data.deals = data.deals.filter((d) => d.contactId !== action.id);
        data.payments = data.payments.filter((p) => p.contactId !== action.id);
        data.notes = data.notes.filter((n) => n.contactId !== action.id);
        data.activities = data.activities.filter((a) => a.contactId !== action.id);
      }
      if (action.collection === "classes") {
        const sessionIds = data.sessions.filter((s) => s.classId === action.id).map((s) => s.id);
        data.sessions = data.sessions.filter((s) => s.classId !== action.id);
        data.attendance = data.attendance.filter((a) => !sessionIds.includes(a.sessionId));
        data.enrollments = data.enrollments.filter((e) => e.classId !== action.id);
      }
      if (action.collection === "sessions") {
        data.attendance = data.attendance.filter((a) => a.sessionId !== action.id);
      }
      if (action.collection === "enrollments") {
        data.payments = data.payments.filter((p) => p.enrollmentId !== action.id);
      }
      return removed;
    }

    case "settings.org":
      data.org = { ...data.org, ...action.org };
      return data.org;

    case "settings.form":
      data.form = { ...data.form, ...action.form };
      return data.form;

    case "settings.lists":
      if (action.sources) data.sources = action.sources;
      if (action.lostReasons) data.lostReasons = action.lostReasons;
      return { sources: data.sources, lostReasons: data.lostReasons };

    case "stages.reorder":
      action.ids.forEach((id, i) => {
        const st = data.stages.find((s) => s.id === id);
        if (st) st.order = i;
      });
      data.stages.sort((a, b) => a.order - b.order);
      return data.stages;

    case "contacts.import": {
      let created = 0;
      let updated = 0;
      for (const row of action.rows) {
        const get = (...keys: string[]) => {
          for (const k of keys) {
            const found = Object.keys(row).find(
              (rk) => rk.toLowerCase().trim() === k.toLowerCase(),
            );
            if (found && row[found]) return row[found].trim();
          }
          return "";
        };
        const name = get("nome", "name", "aluno", "contato");
        const email = get("email", "e-mail");
        const phone = get("telefone", "phone", "celular", "whatsapp");
        if (!name && !email && !phone) continue;
        const existing = data.contacts.find(
          (c) =>
            (email && c.email.toLowerCase() === email.toLowerCase()) ||
            (phone && c.phone.replace(/\D+/g, "") === phone.replace(/\D+/g, "") && !!phone),
        );
        const patch = {
          name: name || existing?.name || "Sem nome",
          email,
          phone: phone.replace(/\D+/g, ""),
          document: get("cpf", "documento"),
          city: get("cidade", "city"),
          state: get("estado", "uf"),
          company: get("empresa", "company"),
          source: get("origem", "source") || "Importacao CSV",
        };
        if (existing) {
          Object.assign(existing, {
            ...patch,
            email: patch.email || existing.email,
            phone: patch.phone || existing.phone,
            updatedAt: nowISO(),
          });
          updated++;
        } else {
          data.contacts.push(emptyContact(patch));
          created++;
        }
      }
      logEvent(data, `Importacao CSV: ${created} criados, ${updated} atualizados.`, "", actor, "import");
      return { created, updated };
    }

    case "contacts.bulk": {
      const ids = new Set(action.ids);
      if (action.op === "delete") {
        for (const id of action.ids) applyAction(data, { type: "remove", collection: "contacts", id }, ctx);
        return { removed: action.ids.length };
      }
      data.contacts.forEach((c) => {
        if (!ids.has(c.id)) return;
        if (action.op === "tag" && action.value && !c.tagIds.includes(action.value))
          c.tagIds.push(action.value);
        if (action.op === "untag" && action.value)
          c.tagIds = c.tagIds.filter((t) => t !== action.value);
        if (action.op === "status" && action.value) c.status = action.value as Contact["status"];
        if (action.op === "owner") c.ownerId = action.value || "";
        if (action.op === "archive") c.archived = true;
        if (action.op === "unarchive") c.archived = false;
        c.updatedAt = nowISO();
      });
      return { updated: action.ids.length };
    }

    case "deal.move": {
      const deal = data.deals.find((d) => d.id === action.id);
      if (!deal) return null;
      const stage = data.stages.find((s) => s.id === action.stageId);
      deal.stageId = action.stageId;
      deal.updatedAt = nowISO();
      if (stage?.kind === "won") {
        deal.status = "ganho";
        deal.closedAt = nowISO();
        deal.probability = 100;
      } else if (stage?.kind === "lost") {
        deal.status = "perdido";
        deal.closedAt = nowISO();
        deal.probability = 0;
      } else {
        deal.status = "aberto";
        deal.closedAt = "";
      }
      logEvent(data, `Negocio "${deal.title}" movido para ${stage?.name || "-"}`, deal.contactId, actor, "negocio");
      return deal;
    }

    case "deal.close": {
      const deal = data.deals.find((d) => d.id === action.id);
      if (!deal) return null;
      deal.status = action.status;
      deal.closedAt = nowISO();
      deal.updatedAt = nowISO();
      deal.lostReason = action.status === "perdido" ? action.lostReason || "" : "";
      const target = data.stages.find((s) => s.kind === (action.status === "ganho" ? "won" : "lost"));
      if (target) deal.stageId = target.id;
      logEvent(
        data,
        `Negocio "${deal.title}" marcado como ${action.status}${deal.lostReason ? ` (${deal.lostReason})` : ""}`,
        deal.contactId,
        actor,
        "negocio",
      );
      return deal;
    }

    case "enroll.create": {
      const contact = data.contacts.find((c) => c.id === action.contactId);
      const klass = data.classes.find((c) => c.id === action.classId);
      if (!contact || !klass) return null;
      const already = data.enrollments.find(
        (e) => e.contactId === action.contactId && e.classId === action.classId && e.status !== "cancelado",
      );
      if (already) return already;
      const course = data.courses.find((c) => c.id === klass.courseId);
      const enrollment: Enrollment = {
        id: uid("enr"),
        contactId: action.contactId,
        classId: action.classId,
        status: action.status || "matriculado",
        price: action.price ?? klass.price ?? course?.price ?? 0,
        discount: action.discount || 0,
        installments: action.installments || 1,
        paymentMethod: action.paymentMethod || "",
        enrolledAt: nowISO(),
        source: contact.source,
        certificateIssued: false,
        notes: "",
      };
      data.enrollments.push(enrollment);
      if (contact.status === "lead") contact.status = "aluno";
      contact.updatedAt = nowISO();
      if (action.generatePayments !== false && enrollment.price > 0) {
        data.payments.push(
          ...buildInstallments(
            enrollment,
            action.firstDueDate || nowISO().slice(0, 10),
            enrollment.installments,
          ),
        );
      }
      logEvent(data, `Matricula criada: ${contact.name} em ${klass.name}`, contact.id, actor, "matricula");
      return enrollment;
    }

    case "enroll.status": {
      const e = data.enrollments.find((x) => x.id === action.id);
      if (!e) return null;
      e.status = action.status;
      const contact = data.contacts.find((c) => c.id === e.contactId);
      if (contact) {
        if (action.status === "concluido") contact.status = "ex-aluno";
        if (action.status === "matriculado") contact.status = "aluno";
      }
      return e;
    }

    case "sessions.generate": {
      const klass = data.classes.find((c) => c.id === action.classId);
      if (!klass) return null;
      const dates = generateSessionDates(klass.startDate, klass.endDate, klass.weekDays);
      const existing = new Set(
        data.sessions.filter((s) => s.classId === klass.id).map((s) => s.date),
      );
      let created = 0;
      dates.forEach((date, i) => {
        if (existing.has(date)) return;
        data.sessions.push({
          id: uid("sess"),
          classId: klass.id,
          date,
          startTime: klass.startTime,
          endTime: klass.endTime,
          topic: `Aula ${i + 1}`,
          teacher: klass.teacher,
          status: "agendada",
          checkinToken: token(10),
          checkinOpen: false,
          createdAt: nowISO(),
        });
        created++;
      });
      logEvent(data, `${created} aulas geradas para ${klass.name}`, "", actor, "turma");
      return { created };
    }

    case "session.checkin": {
      const s = data.sessions.find((x) => x.id === action.id);
      if (!s) return null;
      s.checkinOpen = action.open;
      return s;
    }

    case "class.rotateToken": {
      const c = data.classes.find((x) => x.id === action.id);
      if (!c) return null;
      c.enrollToken = token(10);
      return c;
    }

    case "attendance.set": {
      const existing = data.attendance.find(
        (a) => a.sessionId === action.sessionId && a.contactId === action.contactId,
      );
      if (existing) {
        existing.status = action.status;
        existing.at = nowISO();
        if (action.note !== undefined) existing.note = action.note;
        return existing;
      }
      const record: Attendance = {
        id: uid("att"),
        sessionId: action.sessionId,
        contactId: action.contactId,
        status: action.status,
        method: "manual",
        note: action.note || "",
        at: nowISO(),
      };
      data.attendance.push(record);
      return record;
    }

    case "attendance.fill": {
      const session = data.sessions.find((s) => s.id === action.sessionId);
      if (!session) return null;
      const roster = data.enrollments
        .filter((e) => e.classId === session.classId && ["matriculado", "pre-inscrito"].includes(e.status))
        .map((e) => e.contactId);
      let count = 0;
      roster.forEach((contactId) => {
        const has = data.attendance.find(
          (a) => a.sessionId === action.sessionId && a.contactId === contactId,
        );
        if (has) return;
        data.attendance.push({
          id: uid("att"),
          sessionId: action.sessionId,
          contactId,
          status: action.status,
          method: "manual",
          note: "",
          at: nowISO(),
        });
        count++;
      });
      if (session.status === "agendada") session.status = "realizada";
      return { count };
    }

    case "payments.generate": {
      const enrollment = data.enrollments.find((e) => e.id === action.enrollmentId);
      if (!enrollment) return null;
      data.payments = data.payments.filter(
        (p) => p.enrollmentId !== enrollment.id || p.status === "pago",
      );
      enrollment.installments = action.installments;
      data.payments.push(...buildInstallments(enrollment, action.firstDueDate, action.installments));
      return { ok: true };
    }

    case "payment.pay": {
      const p = data.payments.find((x) => x.id === action.id);
      if (!p) return null;
      p.paidAt = action.paidAt || nowISO().slice(0, 10);
      p.status = "pago";
      if (action.method) p.method = action.method;
      logEvent(data, `Pagamento recebido: ${p.description}`, p.contactId, actor, "financeiro");
      return p;
    }

    case "payment.unpay": {
      const p = data.payments.find((x) => x.id === action.id);
      if (!p) return null;
      p.paidAt = "";
      p.status = "pendente";
      return p;
    }

    case "note.add": {
      const note = {
        id: uid("note"),
        contactId: action.contactId,
        body: action.body,
        authorId: action.authorId,
        createdAt: nowISO(),
      };
      data.notes.unshift(note);
      return note;
    }

    case "activity.toggle": {
      const a = data.activities.find((x) => x.id === action.id);
      if (!a) return null;
      a.done = !a.done;
      a.doneAt = a.done ? nowISO() : "";
      return a;
    }

    case "user.create": {
      if (data.users.some((u) => u.email.toLowerCase() === action.email.toLowerCase())) {
        throw new Error("Ja existe um usuario com este e-mail.");
      }
      const user: User = {
        id: uid("user"),
        name: action.name,
        email: action.email.toLowerCase(),
        role: action.role,
        passwordHash: hashPassword(action.password),
        active: true,
        createdAt: nowISO(),
      };
      data.users.push(user);
      return { id: user.id };
    }

    case "user.password": {
      const u = data.users.find((x) => x.id === action.id);
      if (!u) return null;
      u.passwordHash = hashPassword(action.password);
      return { ok: true };
    }

    case "timeline.add":
      logEvent(data, action.message, action.contactId, actor, action.kind || "nota");
      return { ok: true };

    default:
      throw new Error(`Acao desconhecida: ${(action as { type: string }).type}`);
  }
}

/** Remove segredos antes de mandar o estado ao navegador. */
export function sanitize(data: CrmData): CrmData {
  return {
    ...data,
    users: data.users.map((u) => ({ ...u, passwordHash: "" })),
  };
}
