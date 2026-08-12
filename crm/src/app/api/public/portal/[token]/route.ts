import { NextResponse } from "next/server";
import { readData } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const data = await readData();
  const contact = data.contacts.find((c) => c.portalToken === token);
  if (!contact) return NextResponse.json({ error: "Portal nao encontrado." }, { status: 404 });

  const enrollments = data.enrollments.filter(
    (e) => e.contactId === contact.id && e.status !== "cancelado",
  );

  const courses = enrollments.map((e) => {
    const klass = data.classes.find((c) => c.id === e.classId);
    const course = data.courses.find((c) => c.id === klass?.courseId);
    const sessions = data.sessions
      .filter((s) => s.classId === e.classId && s.status !== "cancelada")
      .sort((a, b) => a.date.localeCompare(b.date));
    const records = data.attendance.filter(
      (a) => a.contactId === contact.id && sessions.some((s) => s.id === a.sessionId),
    );
    const held = sessions.filter((s) => s.status === "realizada");
    const present = records.filter((a) => ["presente", "atrasado", "justificado"].includes(a.status)).length;
    return {
      enrollmentId: e.id,
      status: e.status,
      className: klass?.name || "",
      courseName: course?.name || "",
      teacher: klass?.teacher || "",
      location: klass?.location || "",
      startDate: klass?.startDate || "",
      endDate: klass?.endDate || "",
      minAttendancePct: klass?.minAttendancePct ?? 75,
      attendanceRate: held.length ? present / held.length : 1,
      sessions: sessions.map((s) => ({
        id: s.id,
        date: s.date,
        topic: s.topic,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        attendance: records.find((a) => a.sessionId === s.id)?.status || "",
      })),
    };
  });

  const payments = data.payments
    .filter((p) => p.contactId === contact.id && p.status !== "cancelado")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((p) => ({
      description: p.description,
      amount: p.amount,
      dueDate: p.dueDate,
      status: p.status,
      paidAt: p.paidAt,
    }));

  return NextResponse.json({
    org: data.org,
    student: { name: contact.name, email: contact.email, phone: contact.phone },
    courses,
    payments,
  });
}
