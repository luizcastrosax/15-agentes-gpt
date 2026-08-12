import { NextResponse } from "next/server";
import { readData, withData } from "@/lib/db";
import { nowISO, uid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const data = await readData();
  const session = data.sessions.find((s) => s.checkinToken === token);
  if (!session) return NextResponse.json({ error: "Aula nao encontrada." }, { status: 404 });
  const klass = data.classes.find((c) => c.id === session.classId);
  const course = data.courses.find((c) => c.id === klass?.courseId);
  return NextResponse.json({
    org: data.org,
    open: session.checkinOpen && session.status !== "cancelada",
    session: {
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      topic: session.topic,
      teacher: session.teacher,
    },
    className: klass?.name || "",
    courseName: course?.name || "",
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { identifier?: string };
  const identifier = (body.identifier || "").trim();
  if (!identifier) {
    return NextResponse.json({ error: "Informe seu e-mail ou telefone." }, { status: 400 });
  }

  try {
    const result = await withData((data) => {
      const session = data.sessions.find((s) => s.checkinToken === token);
      if (!session) throw new Error("Aula nao encontrada.");
      if (!session.checkinOpen) throw new Error("A chamada desta aula esta fechada.");

      const digits = identifier.replace(/\D+/g, "");
      const contact = data.contacts.find(
        (c) =>
          c.email.toLowerCase() === identifier.toLowerCase() ||
          (digits.length >= 8 && c.phone.replace(/\D+/g, "").endsWith(digits)),
      );
      if (!contact) throw new Error("Nao encontramos seu cadastro. Fale com a secretaria.");

      const enrolled = data.enrollments.some(
        (e) =>
          e.contactId === contact.id &&
          e.classId === session.classId &&
          ["matriculado", "pre-inscrito"].includes(e.status),
      );
      if (!enrolled) throw new Error("Voce nao esta matriculado nesta turma.");

      const existing = data.attendance.find(
        (a) => a.sessionId === session.id && a.contactId === contact.id,
      );
      if (existing) {
        existing.status = "presente";
        existing.method = "autocheckin";
        existing.at = nowISO();
      } else {
        data.attendance.push({
          id: uid("att"),
          sessionId: session.id,
          contactId: contact.id,
          status: "presente",
          method: "autocheckin",
          note: "",
          at: nowISO(),
        });
      }
      return { ok: true, name: contact.name };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nao foi possivel registrar a presenca.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
