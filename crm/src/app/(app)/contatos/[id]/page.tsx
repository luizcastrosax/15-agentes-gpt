"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { ContactForm } from "@/components/ContactForm";
import { ProgressBar } from "@/components/charts";
import {
  Avatar,
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  brl,
  fmtDate,
  fmtDateTime,
  mailtoLink,
  maskPhone,
  pct,
  renderTemplate,
  todayISO,
  whatsappLink,
} from "@/lib/shared";
import { attendanceRate, effectiveStatus } from "@/lib/selectors";
import type { Contact } from "@/lib/types";

const STATUS_TONE: Record<string, "blue" | "green" | "purple" | "slate"> = {
  lead: "blue",
  aluno: "green",
  "ex-aluno": "purple",
  inativo: "slate",
};

const ATT_TONE: Record<string, "green" | "red" | "amber" | "blue"> = {
  presente: "green",
  falta: "red",
  atrasado: "amber",
  justificado: "blue",
};

export default function ContactDetailPage() {
  const { data, mutate, baseUrl } = useCrm();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const contact = data.contacts.find((c) => c.id === params.id);

  const [tab, setTab] = useState("geral");
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [noteText, setNoteText] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [task, setTask] = useState({ title: "", type: "tarefa", dueDate: todayISO() });
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollForm, setEnrollForm] = useState({
    classId: "",
    price: 0,
    discount: 0,
    installments: 1,
    paymentMethod: "Pix",
    firstDueDate: todayISO(),
    generatePayments: true,
  });
  const [msgOpen, setMsgOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");

  const enrollments = useMemo(
    () => data.enrollments.filter((e) => e.contactId === params.id),
    [data.enrollments, params.id],
  );
  const deals = useMemo(
    () => data.deals.filter((d) => d.contactId === params.id),
    [data.deals, params.id],
  );
  const payments = useMemo(
    () =>
      data.payments
        .filter((p) => p.contactId === params.id)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.payments, params.id],
  );
  const activities = useMemo(
    () =>
      data.activities
        .filter((a) => a.contactId === params.id)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.activities, params.id],
  );
  const notes = useMemo(
    () => data.notes.filter((n) => n.contactId === params.id),
    [data.notes, params.id],
  );
  const timeline = useMemo(
    () => data.timeline.filter((t) => t.contactId === params.id),
    [data.timeline, params.id],
  );

  if (!contact) {
    return (
      <EmptyState
        title="Contato nao encontrado"
        description="Ele pode ter sido excluido."
        action={
          <Link href="/contatos" className="btn-primary btn-sm">
            Voltar para contatos
          </Link>
        }
      />
    );
  }

  const totalPaid = payments
    .filter((p) => effectiveStatus(p) === "pago")
    .reduce((a, p) => a + p.amount, 0);
  const totalOpen = payments
    .filter((p) => ["pendente", "atrasado"].includes(effectiveStatus(p)))
    .reduce((a, p) => a + p.amount, 0);

  const templateVars = {
    nome: contact.name.split(" ")[0],
    nome_completo: contact.name,
    escola: data.org.name,
    curso:
      data.courses.find(
        (c) => c.id === data.classes.find((k) => k.id === enrollments[0]?.classId)?.courseId,
      )?.name || "",
    turma: data.classes.find((k) => k.id === enrollments[0]?.classId)?.name || "",
    inicio: fmtDate(data.classes.find((k) => k.id === enrollments[0]?.classId)?.startDate || ""),
    local: data.classes.find((k) => k.id === enrollments[0]?.classId)?.location || "",
    link: `${baseUrl}/i/${data.classes.find((k) => k.enrollOpen)?.enrollToken || ""}`,
    frequencia: enrollments[0]
      ? pct(attendanceRate(data, contact.id, enrollments[0].classId).rate)
      : "-",
  };

  const template = data.templates.find((t) => t.id === templateId);
  const renderedBody = template ? renderTemplate(template.body, templateVars) : "";
  const renderedSubject = template ? renderTemplate(template.subject, templateVars) : "";

  async function addNote() {
    if (!noteText.trim()) return;
    await mutate({
      type: "note.add",
      contactId: contact!.id,
      body: noteText.trim(),
      authorId: "",
    });
    setNoteText("");
    toast("Anotacao salva.");
  }

  async function saveTask() {
    if (!task.title.trim()) return toast("Descreva a tarefa.", "erro");
    await mutate({
      type: "upsert",
      collection: "activities",
      item: {
        type: task.type,
        title: task.title,
        description: "",
        contactId: contact!.id,
        dealId: "",
        dueDate: task.dueDate,
        done: false,
        doneAt: "",
        ownerId: "",
      },
    });
    setTaskOpen(false);
    setTask({ title: "", type: "tarefa", dueDate: todayISO() });
    toast("Tarefa criada.");
  }

  async function saveEnrollment() {
    if (!enrollForm.classId) return toast("Escolha a turma.", "erro");
    await mutate({
      type: "enroll.create",
      contactId: contact!.id,
      classId: enrollForm.classId,
      price: Number(enrollForm.price),
      discount: Number(enrollForm.discount),
      installments: Number(enrollForm.installments),
      paymentMethod: enrollForm.paymentMethod,
      generatePayments: enrollForm.generatePayments,
      firstDueDate: enrollForm.firstDueDate,
    });
    setEnrollOpen(false);
    toast("Matricula criada.");
  }

  return (
    <div className="space-y-4">
      <Link href="/contatos" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Contatos
      </Link>

      <div className="card-pad">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={contact.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{contact.name}</h1>
              <Badge tone={STATUS_TONE[contact.status]}>{contact.status}</Badge>
              {contact.archived && <Badge tone="slate">arquivado</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
              {contact.email && <span>{contact.email}</span>}
              {contact.phone && <span>{maskPhone(contact.phone)}</span>}
              {contact.city && (
                <span>
                  {contact.city}
                  {contact.state ? `/${contact.state}` : ""}
                </span>
              )}
              {contact.source && <span>Origem: {contact.source}</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {contact.tagIds.map((id) => {
                const t = data.tags.find((x) => x.id === id);
                return t ? (
                  <Badge key={id} color={t.color}>
                    {t.name}
                  </Badge>
                ) : null;
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {contact.phone && (
              <a
                href={whatsappLink(contact.phone)}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost btn-sm"
              >
                WhatsApp
              </a>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setMsgOpen(true)}>
              Usar modelo
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(contact)}>
              Editar
            </button>
            <button className="btn-primary btn-sm" onClick={() => setEnrollOpen(true)}>
              Matricular
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Matriculas</p>
            <p className="text-base font-semibold text-slate-900">{enrollments.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total pago</p>
            <p className="text-base font-semibold text-emerald-600">{brl(totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Em aberto</p>
            <p className="text-base font-semibold text-amber-600">{brl(totalOpen)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Cliente desde</p>
            <p className="text-base font-semibold text-slate-900">{fmtDate(contact.createdAt)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px]">
          <span className="text-slate-500">Portal do aluno:</span>
          <a
            href={`${baseUrl}/portal/${contact.portalToken}`}
            target="_blank"
            rel="noreferrer"
            className="link truncate"
          >
            {baseUrl}/portal/{contact.portalToken}
          </a>
          <button
            className="btn-sub btn-sm ml-auto"
            onClick={() => {
              navigator.clipboard?.writeText(`${baseUrl}/portal/${contact.portalToken}`);
              toast("Link do portal copiado.");
            }}
          >
            Copiar
          </button>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "geral", label: "Visao geral" },
          { id: "matriculas", label: "Matriculas", count: enrollments.length },
          { id: "presenca", label: "Presenca" },
          { id: "financeiro", label: "Financeiro", count: payments.length },
          { id: "negocios", label: "Negocios", count: deals.length },
          { id: "tarefas", label: "Tarefas", count: activities.filter((a) => !a.done).length },
          { id: "notas", label: "Notas", count: notes.length },
          { id: "historico", label: "Historico" },
        ]}
      />

      {tab === "geral" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card-pad lg:col-span-2">
            <h3 className="section-title mb-3">Dados cadastrais</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["E-mail", contact.email],
                ["Telefone", maskPhone(contact.phone)],
                ["CPF / Documento", contact.document],
                ["Nascimento", contact.birthDate ? fmtDate(contact.birthDate) : ""],
                ["Empresa", contact.company],
                ["Cargo", contact.jobTitle],
                ["Endereco", contact.address],
                ["Cidade / UF", [contact.city, contact.state].filter(Boolean).join(" / ")],
                ["Responsavel", data.users.find((u) => u.id === contact.ownerId)?.name || ""],
                [
                  "Consentimento LGPD",
                  contact.lgpdConsentAt ? fmtDateTime(contact.lgpdConsentAt) : "",
                ],
                ...data.customFields.map(
                  (f) => [f.label, String(contact.custom?.[f.key] ?? "")] as [string, string],
                ),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-sm text-slate-800">{value || "-"}</dd>
                </div>
              ))}
            </dl>
            {contact.notes && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Observacoes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{contact.notes}</p>
              </div>
            )}
          </div>

          <div className="card-pad">
            <h3 className="section-title mb-3">Acoes rapidas</h3>
            <div className="space-y-2">
              <button className="btn-ghost btn-sm w-full justify-start" onClick={() => setTaskOpen(true)}>
                Agendar tarefa
              </button>
              <button className="btn-ghost btn-sm w-full justify-start" onClick={() => setEnrollOpen(true)}>
                Nova matricula
              </button>
              {contact.email && (
                <a
                  className="btn-ghost btn-sm w-full justify-start"
                  href={mailtoLink(contact.email)}
                >
                  Enviar e-mail
                </a>
              )}
              <ConfirmButton
                className="btn-danger btn-sm w-full justify-start"
                message="Excluir este contato e todos os registros ligados a ele?"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "contacts", id: contact.id });
                  router.push("/contatos");
                }}
              >
                Excluir contato
              </ConfirmButton>
            </div>
          </div>
        </div>
      )}

      {tab === "matriculas" && (
        <div className="card overflow-hidden">
          {enrollments.length ? (
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Turma</th>
                  <th className="th">Situacao</th>
                  <th className="th">Valor</th>
                  <th className="th">Matriculado em</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {enrollments.map((e) => {
                  const klass = data.classes.find((c) => c.id === e.classId);
                  return (
                    <tr key={e.id} className="row-hover">
                      <td className="td">
                        <Link href={`/turmas/${e.classId}`} className="font-medium text-slate-800 hover:text-indigo-700">
                          {klass?.name || "-"}
                        </Link>
                        <p className="text-xs text-slate-500">{klass?.teacher}</p>
                      </td>
                      <td className="td">
                        <Select
                          className="w-auto py-1 text-[13px]"
                          value={e.status}
                          onChange={(ev) =>
                            mutate({
                              type: "enroll.status",
                              id: e.id,
                              status: ev.target.value as typeof e.status,
                            })
                          }
                        >
                          <option value="pre-inscrito">Pre-inscrito</option>
                          <option value="matriculado">Matriculado</option>
                          <option value="concluido">Concluido</option>
                          <option value="trancado">Trancado</option>
                          <option value="cancelado">Cancelado</option>
                        </Select>
                      </td>
                      <td className="td">{brl(e.price - e.discount)}</td>
                      <td className="td text-slate-500">{fmtDate(e.enrolledAt)}</td>
                      <td className="td text-right">
                        <ConfirmButton
                          onConfirm={() =>
                            mutate({ type: "remove", collection: "enrollments", id: e.id })
                          }
                          message="Remover esta matricula e suas parcelas?"
                        >
                          Remover
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Sem matriculas"
              description="Matricule este contato em uma turma."
              action={
                <button className="btn-primary btn-sm" onClick={() => setEnrollOpen(true)}>
                  Matricular
                </button>
              }
            />
          )}
        </div>
      )}

      {tab === "presenca" && (
        <div className="space-y-4">
          {enrollments.length ? (
            enrollments.map((e) => {
              const klass = data.classes.find((c) => c.id === e.classId);
              const stat = attendanceRate(data, contact.id, e.classId);
              const sessions = data.sessions
                .filter((s) => s.classId === e.classId)
                .sort((a, b) => a.date.localeCompare(b.date));
              const min = (klass?.minAttendancePct ?? 75) / 100;
              return (
                <div key={e.id} className="card-pad">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[15px] font-semibold text-slate-900">{klass?.name}</h3>
                      <p className="text-xs text-slate-500">
                        {stat.present} presencas em {stat.held} aulas realizadas
                      </p>
                    </div>
                    <div className="flex w-full max-w-xs items-center gap-2">
                      <ProgressBar
                        value={stat.rate}
                        color={stat.rate >= min ? "#16a34a" : "#dc2626"}
                      />
                      <span
                        className={`text-sm font-semibold ${stat.rate >= min ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {pct(stat.rate)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sessions.map((s) => {
                      const rec = data.attendance.find(
                        (a) => a.sessionId === s.id && a.contactId === contact.id,
                      );
                      const label = rec?.status || (s.status === "realizada" ? "falta" : "-");
                      const colors: Record<string, string> = {
                        presente: "bg-emerald-100 text-emerald-700",
                        falta: "bg-rose-100 text-rose-700",
                        atrasado: "bg-amber-100 text-amber-700",
                        justificado: "bg-sky-100 text-sky-700",
                        "-": "bg-slate-100 text-slate-400",
                      };
                      return (
                        <span
                          key={s.id}
                          title={`${fmtDate(s.date)} - ${s.topic} - ${label}`}
                          className={`flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-semibold ${colors[label]}`}
                        >
                          {s.date.slice(8, 10)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState title="Sem turmas" description="Este contato ainda nao esta em nenhuma turma." />
          )}
        </div>
      )}

      {tab === "financeiro" && (
        <div className="card overflow-hidden">
          {payments.length ? (
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Descricao</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Valor</th>
                  <th className="th">Situacao</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => {
                  const st = effectiveStatus(p);
                  return (
                    <tr key={p.id} className="row-hover">
                      <td className="td">{p.description}</td>
                      <td className="td text-slate-600">{fmtDate(p.dueDate)}</td>
                      <td className="td font-medium">{brl(p.amount)}</td>
                      <td className="td">
                        <Badge tone={st === "pago" ? "green" : st === "atrasado" ? "red" : "amber"}>
                          {st}
                        </Badge>
                      </td>
                      <td className="td text-right">
                        {st === "pago" ? (
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => mutate({ type: "payment.unpay", id: p.id })}
                          >
                            Desfazer
                          </button>
                        ) : (
                          <button
                            className="btn-sub btn-sm"
                            onClick={() =>
                              mutate({ type: "payment.pay", id: p.id, paidAt: todayISO() })
                            }
                          >
                            Registrar pagamento
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Sem lancamentos" description="Nenhuma parcela gerada para este contato." />
          )}
        </div>
      )}

      {tab === "negocios" && (
        <div className="card overflow-hidden">
          {deals.length ? (
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Negocio</th>
                  <th className="th">Etapa</th>
                  <th className="th">Valor</th>
                  <th className="th">Situacao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deals.map((d) => {
                  const stage = data.stages.find((s) => s.id === d.stageId);
                  return (
                    <tr key={d.id} className="row-hover">
                      <td className="td font-medium text-slate-800">{d.title}</td>
                      <td className="td">
                        {stage && <Badge color={stage.color}>{stage.name}</Badge>}
                      </td>
                      <td className="td">{brl(d.value)}</td>
                      <td className="td">
                        <Badge
                          tone={d.status === "ganho" ? "green" : d.status === "perdido" ? "red" : "slate"}
                        >
                          {d.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Nenhum negocio" description="Crie um negocio no funil de vendas." />
          )}
        </div>
      )}

      {tab === "tarefas" && (
        <div className="card-pad space-y-3">
          <button className="btn-primary btn-sm" onClick={() => setTaskOpen(true)}>
            Nova tarefa
          </button>
          {activities.length ? (
            <ul className="divide-y divide-slate-100">
              {activities.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={a.done}
                    onChange={() => mutate({ type: "activity.toggle", id: a.id })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${a.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {a.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.type} - {fmtDate(a.dueDate)}
                    </p>
                  </div>
                  <ConfirmButton
                    className="btn-ghost btn-sm"
                    onConfirm={() => mutate({ type: "remove", collection: "activities", id: a.id })}
                  >
                    Excluir
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">Nenhuma tarefa registrada.</p>
          )}
        </div>
      )}

      {tab === "notas" && (
        <div className="card-pad space-y-3">
          <div className="flex gap-2">
            <Textarea
              rows={2}
              placeholder="Escreva uma anotacao sobre este contato..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button className="btn-primary btn-sm self-end" onClick={addNote}>
              Salvar
            </button>
          </div>
          {notes.length ? (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-slate-50 p-3">
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">Nenhuma anotacao ainda.</p>
          )}
        </div>
      )}

      {tab === "historico" && (
        <div className="card-pad">
          {timeline.length ? (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {timeline.map((t) => (
                <li key={t.id} className="relative">
                  <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                  <p className="text-sm text-slate-800">{t.message}</p>
                  <p className="text-[11px] text-slate-400">
                    {fmtDateTime(t.createdAt)} - {t.actor}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">Sem eventos registrados.</p>
          )}
        </div>
      )}

      <ContactForm value={editing} onClose={() => setEditing(null)} />

      <Modal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        title="Nova tarefa"
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setTaskOpen(false)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={saveTask}>
              Criar tarefa
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="O que precisa ser feito?">
            <Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={task.type} onChange={(e) => setTask({ ...task, type: e.target.value })}>
                <option value="tarefa">Tarefa</option>
                <option value="ligacao">Ligacao</option>
                <option value="reuniao">Reuniao</option>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </Select>
            </Field>
            <Field label="Prazo">
              <Input
                type="date"
                value={task.dueDate}
                onChange={(e) => setTask({ ...task, dueDate: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Nova matricula"
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setEnrollOpen(false)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={saveEnrollment}>
              Confirmar matricula
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Turma" className="sm:col-span-2">
            <Select
              value={enrollForm.classId}
              onChange={(e) => {
                const klass = data.classes.find((c) => c.id === e.target.value);
                const course = data.courses.find((c) => c.id === klass?.courseId);
                setEnrollForm({
                  ...enrollForm,
                  classId: e.target.value,
                  price: klass?.price ?? course?.price ?? 0,
                });
              }}
            >
              <option value="">Selecione a turma...</option>
              {data.classes
                .filter((c) => !["cancelada", "concluida"].includes(c.status))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Valor (R$)">
            <Input
              type="number"
              step="0.01"
              value={enrollForm.price}
              onChange={(e) => setEnrollForm({ ...enrollForm, price: Number(e.target.value) })}
            />
          </Field>
          <Field label="Desconto (R$)">
            <Input
              type="number"
              step="0.01"
              value={enrollForm.discount}
              onChange={(e) => setEnrollForm({ ...enrollForm, discount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Parcelas">
            <Input
              type="number"
              min={1}
              max={24}
              value={enrollForm.installments}
              onChange={(e) => setEnrollForm({ ...enrollForm, installments: Number(e.target.value) })}
            />
          </Field>
          <Field label="Forma de pagamento">
            <Select
              value={enrollForm.paymentMethod}
              onChange={(e) => setEnrollForm({ ...enrollForm, paymentMethod: e.target.value })}
            >
              {["Pix", "Cartao de credito", "Boleto", "Dinheiro", "Transferencia", "Empresa paga"].map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="1o vencimento">
            <Input
              type="date"
              value={enrollForm.firstDueDate}
              onChange={(e) => setEnrollForm({ ...enrollForm, firstDueDate: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={enrollForm.generatePayments}
                onChange={(e) =>
                  setEnrollForm({ ...enrollForm, generatePayments: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Gerar parcelas no financeiro
            </label>
          </div>
          <p className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Total: <b>{brl(Number(enrollForm.price) - Number(enrollForm.discount))}</b> em{" "}
            {enrollForm.installments}x de{" "}
            <b>
              {brl(
                (Number(enrollForm.price) - Number(enrollForm.discount)) /
                  Math.max(1, Number(enrollForm.installments)),
              )}
            </b>
          </p>
        </div>
      </Modal>

      <Modal
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        title="Enviar mensagem com modelo"
        wide
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setMsgOpen(false)}>
              Fechar
            </button>
            {template?.channel === "whatsapp" && contact.phone && (
              <a
                className="btn-primary btn-sm"
                href={whatsappLink(contact.phone, renderedBody)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no WhatsApp
              </a>
            )}
            {template?.channel === "email" && contact.email && (
              <a
                className="btn-primary btn-sm"
                href={mailtoLink(contact.email, renderedSubject, renderedBody)}
              >
                Abrir no e-mail
              </a>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Modelo">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Selecione um modelo...</option>
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.channel})
                </option>
              ))}
            </Select>
          </Field>
          {template && (
            <>
              {template.channel === "email" && (
                <Field label="Assunto">
                  <Input readOnly value={renderedSubject} />
                </Field>
              )}
              <Field label="Mensagem">
                <Textarea rows={7} readOnly value={renderedBody} />
              </Field>
              <button
                className="btn-sub btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(renderedBody);
                  toast("Mensagem copiada.");
                }}
              >
                Copiar texto
              </button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
