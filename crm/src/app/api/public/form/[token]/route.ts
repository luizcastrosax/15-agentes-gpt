import { NextResponse } from "next/server";
import { readData } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const data = await readData();
  const klass = data.classes.find((c) => c.enrollToken === token);
  if (!klass) {
    return NextResponse.json({ error: "Link de inscricao nao encontrado." }, { status: 404 });
  }
  const course = data.courses.find((c) => c.id === klass.courseId) || null;
  const taken = data.enrollments.filter(
    (e) => e.classId === klass.id && e.status !== "cancelado",
  ).length;

  return NextResponse.json({
    org: data.org,
    form: data.form,
    customFields: data.customFields.filter((f) => f.showOnForm),
    open: klass.enrollOpen && !["cancelada", "concluida"].includes(klass.status),
    seatsLeft: Math.max(0, (klass.capacity || 0) - taken),
    klass: {
      id: klass.id,
      name: klass.name,
      teacher: klass.teacher,
      location: klass.location,
      startDate: klass.startDate,
      endDate: klass.endDate,
      weekDays: klass.weekDays,
      startTime: klass.startTime,
      endTime: klass.endTime,
      price: klass.price ?? course?.price ?? 0,
      status: klass.status,
    },
    course: course
      ? {
          name: course.name,
          description: course.description,
          hours: course.hours,
          modality: course.modality,
          category: course.category,
        }
      : null,
  });
}
