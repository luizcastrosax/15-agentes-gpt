"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { brl, searchMatch } from "@/lib/shared";
import type { Course } from "@/lib/types";

const blank: Partial<Course> = {
  name: "",
  code: "",
  description: "",
  category: "",
  price: 0,
  hours: 0,
  modality: "presencial",
  active: true,
};

export default function CoursesPage() {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Course> | null>(null);

  const courses = useMemo(
    () => data.courses.filter((c) => searchMatch(`${c.name} ${c.code} ${c.category}`, q)),
    [data.courses, q],
  );

  async function save() {
    if (!editing?.name?.trim()) return toast("Informe o nome do curso.", "erro");
    await mutate({
      type: "upsert",
      collection: "courses",
      item: {
        ...editing,
        price: Number(editing.price) || 0,
        hours: Number(editing.hours) || 0,
      } as Record<string, unknown>,
    });
    setEditing(null);
    toast("Curso salvo.");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cursos"
        subtitle="Catalogo de cursos oferecidos"
        actions={
          <>
            <Input
              placeholder="Buscar curso..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full sm:w-56"
            />
            <button className="btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>
              Novo curso
            </button>
          </>
        }
      />

      {courses.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const classes = data.classes.filter((k) => k.courseId === c.id);
            const students = data.enrollments.filter(
              (e) => classes.some((k) => k.id === e.classId) && e.status !== "cancelado",
            ).length;
            return (
              <div key={c.id} className="card-pad flex flex-col">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold text-slate-900">{c.name}</h3>
                    <p className="text-xs text-slate-500">
                      {c.code || "sem codigo"} - {c.category || "sem categoria"}
                    </p>
                  </div>
                  <Badge tone={c.active ? "green" : "slate"}>{c.active ? "ativo" : "inativo"}</Badge>
                </div>
                <p className="line-clamp-3 flex-1 text-[13px] text-slate-600">{c.description}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                  <div>
                    <p className="text-[11px] text-slate-500">Valor</p>
                    <p className="text-[13px] font-semibold text-slate-900">{brl(c.price)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Carga</p>
                    <p className="text-[13px] font-semibold text-slate-900">{c.hours}h</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Alunos</p>
                    <p className="text-[13px] font-semibold text-slate-900">{students}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone="indigo">{c.modality}</Badge>
                  <span className="text-[11px] text-slate-500">{classes.length} turma(s)</span>
                  <div className="ml-auto flex gap-1">
                    <Link href="/turmas" className="btn-ghost btn-sm">
                      Turmas
                    </Link>
                    <button className="btn-sub btn-sm" onClick={() => setEditing(c)}>
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title="Nenhum curso cadastrado"
            description="Cadastre o primeiro curso para comecar a abrir turmas."
            action={
              <button className="btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>
                Novo curso
              </button>
            }
          />
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar curso" : "Novo curso"}
        wide
        footer={
          <>
            {editing?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                message="Excluir o curso? As turmas continuarao existindo mas ficarao sem curso."
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "courses", id: editing.id! });
                  setEditing(null);
                  toast("Curso excluido.");
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={save}>
              Salvar
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do curso *" className="sm:col-span-2">
              <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Codigo">
              <Input value={editing.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </Field>
            <Field label="Categoria">
              <Input
                value={editing.category || ""}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              />
            </Field>
            <Field label="Valor padrao (R$)">
              <Input
                type="number"
                step="0.01"
                value={editing.price ?? 0}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
            </Field>
            <Field label="Carga horaria (h)">
              <Input
                type="number"
                value={editing.hours ?? 0}
                onChange={(e) => setEditing({ ...editing, hours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Modalidade">
              <Select
                value={editing.modality || "presencial"}
                onChange={(e) =>
                  setEditing({ ...editing, modality: e.target.value as Course["modality"] })
                }
              >
                <option value="presencial">Presencial</option>
                <option value="online">Online</option>
                <option value="hibrido">Hibrido</option>
              </Select>
            </Field>
            <Field label="Situacao">
              <Select
                value={editing.active === false ? "0" : "1"}
                onChange={(e) => setEditing({ ...editing, active: e.target.value === "1" })}
              >
                <option value="1">Ativo</option>
                <option value="0">Inativo</option>
              </Select>
            </Field>
            <Field label="Descricao" className="sm:col-span-2">
              <Textarea
                rows={4}
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
