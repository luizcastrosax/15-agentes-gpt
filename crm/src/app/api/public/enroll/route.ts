import { NextResponse } from "next/server";
import { withData } from "@/lib/db";
import { applyAction, emptyContact } from "@/lib/mutations";
import { nowISO, uid } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Payload {
  token: string;
  name: string;
  email: string;
  phone: string;
  document?: string;
  birthDate?: string;
  city?: string;
  state?: string;
  address?: string;
  zip?: string;
  company?: string;
  jobTitle?: string;
  source?: string;
  consent?: boolean;
  custom?: Record<string, string>;
  message?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Payload | null;
  if (!body?.token) return NextResponse.json({ error: "Link invalido." }, { status: 400 });
  if (!body.name?.trim() || !body.email?.trim()) {
    return NextResponse.json({ error: "Nome e e-mail sao obrigatorios." }, { status: 400 });
  }
  if (!body.consent) {
    return NextResponse.json({ error: "E necessario aceitar os termos." }, { status: 400 });
  }

  try {
    const result = await withData((data) => {
      const klass = data.classes.find((c) => c.enrollToken === body.token);
      if (!klass) throw new Error("Link de inscricao nao encontrado.");
      if (!klass.enrollOpen || ["cancelada", "concluida"].includes(klass.status)) {
        throw new Error("As inscricoes para esta turma estao encerradas.");
      }
      const taken = data.enrollments.filter(
        (e) => e.classId === klass.id && e.status !== "cancelado",
      ).length;
      if (klass.capacity > 0 && taken >= klass.capacity) {
        throw new Error("Todas as vagas desta turma foram preenchidas.");
      }

      const email = body.email.trim().toLowerCase();
      const phone = (body.phone || "").replace(/\D+/g, "");
      let contact = data.contacts.find(
        (c) =>
          (!!email && c.email.toLowerCase() === email) ||
          (!!phone && c.phone.replace(/\D+/g, "") === phone),
      );

      if (contact) {
        Object.assign(contact, {
          name: body.name.trim() || contact.name,
          phone: phone || contact.phone,
          document: body.document || contact.document,
          birthDate: body.birthDate || contact.birthDate,
          city: body.city || contact.city,
          state: body.state || contact.state,
          address: body.address || contact.address,
          zip: body.zip || contact.zip,
          company: body.company || contact.company,
          jobTitle: body.jobTitle || contact.jobTitle,
          custom: { ...contact.custom, ...(body.custom || {}) },
          optInEmail: true,
          optInWhatsapp: true,
          lgpdConsentAt: nowISO(),
          updatedAt: nowISO(),
        });
      } else {
        contact = emptyContact({
          name: body.name.trim(),
          email,
          phone,
          document: body.document || "",
          birthDate: body.birthDate || "",
          city: body.city || "",
          state: body.state || "",
          address: body.address || "",
          zip: body.zip || "",
          company: body.company || "",
          jobTitle: body.jobTitle || "",
          source: body.source || "Formulario de inscricao",
          status: "lead",
          custom: body.custom || {},
          optInEmail: true,
          optInWhatsapp: true,
          lgpdConsentAt: nowISO(),
        });
        data.contacts.push(contact);
      }

      const existing = data.enrollments.find(
        (e) => e.contactId === contact!.id && e.classId === klass.id && e.status !== "cancelado",
      );

      if (!existing) {
        applyAction(
          data,
          {
            type: "enroll.create",
            contactId: contact.id,
            classId: klass.id,
            status: "pre-inscrito",
            generatePayments: false,
          },
          { actor: "formulario publico" },
        );

        const firstStage = [...data.stages].sort((a, b) => a.order - b.order)[0];
        const course = data.courses.find((c) => c.id === klass.courseId);
        if (firstStage) {
          data.deals.push({
            id: uid("deal"),
            title: `${course?.name || klass.name} - ${contact.name.split(" ")[0]}`,
            contactId: contact.id,
            courseId: klass.courseId,
            classId: klass.id,
            value: klass.price ?? course?.price ?? 0,
            stageId: firstStage.id,
            status: "aberto",
            probability: 30,
            expectedCloseDate: klass.startDate,
            lostReason: "",
            ownerId: "",
            source: body.source || "Formulario de inscricao",
            createdAt: nowISO(),
            updatedAt: nowISO(),
            closedAt: "",
          });
        }
      }

      if (body.message?.trim()) {
        data.notes.unshift({
          id: uid("note"),
          contactId: contact.id,
          body: `Mensagem enviada no formulario: ${body.message.trim()}`,
          authorId: "",
          createdAt: nowISO(),
        });
      }

      applyAction(
        data,
        {
          type: "timeline.add",
          contactId: contact.id,
          message: `Nova inscricao pelo link publico: ${contact.name} -> ${klass.name}`,
          kind: "inscricao",
        },
        { actor: "formulario publico" },
      );

      return { ok: true, portalToken: contact.portalToken, contactName: contact.name };
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nao foi possivel concluir a inscricao.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
