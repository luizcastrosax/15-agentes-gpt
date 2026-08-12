"use client";

import { useState } from "react";
import { useCrm } from "./DataProvider";
import { Checkbox, Field, Input, Modal, Select, Textarea, useToast } from "./ui";
import type { Contact } from "@/lib/types";

export const blankContact: Partial<Contact> = {
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
};

export function ContactForm({
  value,
  onClose,
  onSaved,
}: {
  value: Partial<Contact> | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Contact>>(value || blankContact);
  const [saving, setSaving] = useState(false);

  // Sincroniza quando abre com outro contato
  const [lastId, setLastId] = useState(value?.id);
  if (value && value.id !== lastId) {
    setLastId(value.id);
    setDraft(value);
  }

  const set = (patch: Partial<Contact>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    if (!draft.name?.trim()) return toast("Informe o nome.", "erro");
    setSaving(true);
    try {
      const [saved] = (await mutate({
        type: "upsert",
        collection: "contacts",
        item: draft as Record<string, unknown>,
      })) as [Contact];
      toast("Contato salvo.");
      onSaved?.(saved?.id || draft.id || "");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Erro ao salvar.", "erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!value}
      onClose={onClose}
      wide
      title={draft.id ? "Editar contato" : "Novo contato"}
      footer={
        <>
          <button className="btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar contato"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome completo *" className="sm:col-span-2">
          <Input value={draft.name || ""} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={draft.email || ""} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Telefone / WhatsApp">
          <Input value={draft.phone || ""} onChange={(e) => set({ phone: e.target.value })} placeholder="11999998888" />
        </Field>
        <Field label="CPF / Documento">
          <Input value={draft.document || ""} onChange={(e) => set({ document: e.target.value })} />
        </Field>
        <Field label="Data de nascimento">
          <Input type="date" value={draft.birthDate || ""} onChange={(e) => set({ birthDate: e.target.value })} />
        </Field>
        <Field label="Situacao">
          <Select
            value={draft.status || "lead"}
            onChange={(e) => set({ status: e.target.value as Contact["status"] })}
          >
            <option value="lead">Lead</option>
            <option value="aluno">Aluno</option>
            <option value="ex-aluno">Ex-aluno</option>
            <option value="inativo">Inativo</option>
          </Select>
        </Field>
        <Field label="Origem">
          <Select value={draft.source || ""} onChange={(e) => set({ source: e.target.value })}>
            <option value="">Nao informado</option>
            {data.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsavel">
          <Select value={draft.ownerId || ""} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Sem responsavel</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Empresa">
          <Input value={draft.company || ""} onChange={(e) => set({ company: e.target.value })} />
        </Field>
        <Field label="Cargo">
          <Input value={draft.jobTitle || ""} onChange={(e) => set({ jobTitle: e.target.value })} />
        </Field>
        <Field label="Cidade">
          <Input value={draft.city || ""} onChange={(e) => set({ city: e.target.value })} />
        </Field>
        <Field label="Estado">
          <Input value={draft.state || ""} onChange={(e) => set({ state: e.target.value })} maxLength={2} />
        </Field>
        <Field label="Endereco" className="sm:col-span-2">
          <Input value={draft.address || ""} onChange={(e) => set({ address: e.target.value })} />
        </Field>

        <div className="sm:col-span-2">
          <label className="label">Etiquetas</label>
          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((t) => {
              const on = (draft.tagIds || []).includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    set({
                      tagIds: on
                        ? (draft.tagIds || []).filter((x) => x !== t.id)
                        : [...(draft.tagIds || []), t.id],
                    })
                  }
                  className="chip border transition"
                  style={{
                    background: on ? `${t.color}1a` : "#fff",
                    color: on ? t.color : "#64748b",
                    borderColor: on ? t.color : "#e2e8f0",
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        {data.customFields.map((f) => (
          <Field key={f.id} label={f.label} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            {f.type === "select" ? (
              <Select
                value={String(draft.custom?.[f.key] ?? "")}
                onChange={(e) => set({ custom: { ...(draft.custom || {}), [f.key]: e.target.value } })}
              >
                <option value="">Selecione...</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea
                rows={2}
                value={String(draft.custom?.[f.key] ?? "")}
                onChange={(e) => set({ custom: { ...(draft.custom || {}), [f.key]: e.target.value } })}
              />
            ) : f.type === "checkbox" ? (
              <Checkbox
                checked={Boolean(draft.custom?.[f.key])}
                onChange={(v) => set({ custom: { ...(draft.custom || {}), [f.key]: v } })}
                label="Sim"
              />
            ) : (
              <Input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                value={String(draft.custom?.[f.key] ?? "")}
                onChange={(e) => set({ custom: { ...(draft.custom || {}), [f.key]: e.target.value } })}
              />
            )}
          </Field>
        ))}

        <Field label="Observacoes" className="sm:col-span-2">
          <Textarea rows={3} value={draft.notes || ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox
            checked={draft.optInEmail !== false}
            onChange={(v) => set({ optInEmail: v })}
            label="Aceita receber e-mails"
          />
          <Checkbox
            checked={draft.optInWhatsapp !== false}
            onChange={(v) => set({ optInWhatsapp: v })}
            label="Aceita receber WhatsApp"
          />
        </div>
      </div>
    </Modal>
  );
}
