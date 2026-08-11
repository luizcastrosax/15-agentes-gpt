"use client";

import { useState } from "react";
import { useCrm } from "@/components/DataProvider";
import {
  Badge,
  ConfirmButton,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import { slugify } from "@/lib/shared";
import type { CustomField, Stage, Tag, Template, User } from "@/lib/types";

export default function SettingsPage() {
  const { data, user, storage, mutate, resetDemo, baseUrl } = useCrm();
  const toast = useToast();
  const [tab, setTab] = useState("organizacao");

  const [org, setOrg] = useState(data.org);
  const [form, setForm] = useState(data.form);
  const [sources, setSources] = useState(data.sources.join("\n"));
  const [lostReasons, setLostReasons] = useState(data.lostReasons.join("\n"));

  const [stageEdit, setStageEdit] = useState<Partial<Stage> | null>(null);
  const [tagEdit, setTagEdit] = useState<Partial<Tag> | null>(null);
  const [fieldEdit, setFieldEdit] = useState<Partial<CustomField> | null>(null);
  const [tplEdit, setTplEdit] = useState<Partial<Template> | null>(null);
  const [userEdit, setUserEdit] = useState<{ name: string; email: string; role: User["role"]; password: string } | null>(null);
  const [pwdFor, setPwdFor] = useState<User | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-4">
      <PageHeader title="Configuracoes" subtitle="Personalize o CRM para a sua escola" />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "organizacao", label: "Organizacao" },
          { id: "formulario", label: "Formulario publico" },
          { id: "funil", label: "Funil e etiquetas" },
          { id: "campos", label: "Campos e listas" },
          { id: "modelos", label: "Modelos de mensagem" },
          { id: "usuarios", label: "Usuarios" },
          { id: "dados", label: "Dados e banco" },
        ]}
      />

      {tab === "organizacao" && (
        <div className="card-pad grid gap-4 sm:grid-cols-2">
          <Field label="Nome da escola / marca" className="sm:col-span-2">
            <Input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
          </Field>
          <Field label="Slogan">
            <Input value={org.tagline} onChange={(e) => setOrg({ ...org, tagline: e.target.value })} />
          </Field>
          <Field label="Sigla do logo" hint="Ate 3 letras, aparece no menu.">
            <Input
              maxLength={3}
              value={org.logoText}
              onChange={(e) => setOrg({ ...org, logoText: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="E-mail de contato">
            <Input value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
          </Field>
          <Field label="Site">
            <Input value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} />
          </Field>
          <Field label="Cor principal">
            <div className="flex gap-2">
              <input
                type="color"
                value={org.primaryColor}
                onChange={(e) => setOrg({ ...org, primaryColor: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300"
              />
              <Input value={org.primaryColor} onChange={(e) => setOrg({ ...org, primaryColor: e.target.value })} />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <button
              className="btn-primary btn-sm"
              disabled={!isAdmin}
              onClick={async () => {
                await mutate({ type: "settings.org", org });
                toast("Configuracoes salvas.");
              }}
            >
              Salvar organizacao
            </button>
            {!isAdmin && <span className="ml-2 text-[13px] text-slate-500">Somente administradores.</span>}
          </div>
        </div>
      )}

      {tab === "formulario" && (
        <div className="card-pad grid gap-4 sm:grid-cols-2">
          <Field label="Titulo do formulario" className="sm:col-span-2">
            <Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          </Field>
          <Field label="Subtitulo" className="sm:col-span-2">
            <Input
              value={form.subheadline}
              onChange={(e) => setForm({ ...form, subheadline: e.target.value })}
            />
          </Field>
          <Field label="Mensagem apos o envio" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.successMessage}
              onChange={(e) => setForm({ ...form, successMessage: e.target.value })}
            />
          </Field>
          <Field label="Texto de consentimento (LGPD)" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.lgpdText}
              onChange={(e) => setForm({ ...form, lgpdText: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <label className="label">Campos exibidos</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["requirePhone", "Telefone obrigatorio"],
                  ["askDocument", "Pedir CPF / documento"],
                  ["askBirthDate", "Pedir data de nascimento"],
                  ["askAddress", "Pedir endereco"],
                  ["askCompany", "Pedir empresa e cargo"],
                  ["askHowFound", "Perguntar como conheceu"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(form[key])}
                    onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                await mutate({ type: "settings.form", form });
                toast("Formulario atualizado.");
              }}
            >
              Salvar formulario
            </button>
          </div>
          <p className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">
            Cada turma tem o proprio link publico, encontrado em <b>Turmas &gt; Link de inscricao</b>.
            Exemplo: <code className="rounded bg-white px-1">{baseUrl}/i/SEU-TOKEN</code>
          </p>
        </div>
      )}

      {tab === "funil" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">Etapas do funil</h3>
              <button
                className="btn-primary btn-sm"
                onClick={() =>
                  setStageEdit({ name: "", color: "#6366f1", kind: "open", order: data.stages.length })
                }
              >
                Nova etapa
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {[...data.stages]
                .sort((a, b) => a.order - b.order)
                .map((s, i, arr) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 text-sm text-slate-800">{s.name}</span>
                    <Badge tone={s.kind === "won" ? "green" : s.kind === "lost" ? "red" : "slate"}>
                      {s.kind === "won" ? "ganho" : s.kind === "lost" ? "perdido" : "aberto"}
                    </Badge>
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-sm"
                        disabled={i === 0}
                        onClick={() => {
                          const ids = arr.map((x) => x.id);
                          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                          mutate({ type: "stages.reorder", ids });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={i === arr.length - 1}
                        onClick={() => {
                          const ids = arr.map((x) => x.id);
                          [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                          mutate({ type: "stages.reorder", ids });
                        }}
                      >
                        ↓
                      </button>
                      <button className="btn-sub btn-sm" onClick={() => setStageEdit(s)}>
                        Editar
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>

          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">Etiquetas</h3>
              <button className="btn-primary btn-sm" onClick={() => setTagEdit({ name: "", color: "#0ea5e9" })}>
                Nova etiqueta
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.tags.map((t) => (
                <button key={t.id} onClick={() => setTagEdit(t)} className="chip border" style={{ background: `${t.color}1a`, color: t.color, borderColor: t.color }}>
                  {t.name}
                </button>
              ))}
              {!data.tags.length && <p className="text-sm text-slate-400">Nenhuma etiqueta.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "campos" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">Campos personalizados</h3>
              <button
                className="btn-primary btn-sm"
                onClick={() =>
                  setFieldEdit({
                    label: "",
                    key: "",
                    type: "text",
                    options: [],
                    required: false,
                    showOnForm: true,
                    entity: "contact",
                    order: data.customFields.length,
                  })
                }
              >
                Novo campo
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {data.customFields.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{f.label}</p>
                    <p className="text-xs text-slate-500">
                      {f.key} - {f.type}
                      {f.showOnForm ? " - aparece no formulario" : ""}
                    </p>
                  </div>
                  <button className="btn-sub btn-sm" onClick={() => setFieldEdit(f)}>
                    Editar
                  </button>
                </li>
              ))}
              {!data.customFields.length && (
                <p className="py-4 text-sm text-slate-400">Nenhum campo personalizado.</p>
              )}
            </ul>
          </div>

          <div className="card-pad space-y-4">
            <Field label="Origens de contato (uma por linha)">
              <Textarea rows={7} value={sources} onChange={(e) => setSources(e.target.value)} />
            </Field>
            <Field label="Motivos de perda (um por linha)">
              <Textarea rows={5} value={lostReasons} onChange={(e) => setLostReasons(e.target.value)} />
            </Field>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                await mutate({
                  type: "settings.lists",
                  sources: sources.split("\n").map((s) => s.trim()).filter(Boolean),
                  lostReasons: lostReasons.split("\n").map((s) => s.trim()).filter(Boolean),
                });
                toast("Listas atualizadas.");
              }}
            >
              Salvar listas
            </button>
          </div>
        </div>
      )}

      {tab === "modelos" && (
        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Modelos de mensagem</h3>
              <p className="text-xs text-slate-500">
                Variaveis: {"{{nome}} {{escola}} {{curso}} {{turma}} {{inicio}} {{local}} {{link}} {{frequencia}}"}
              </p>
            </div>
            <button
              className="btn-primary btn-sm"
              onClick={() => setTplEdit({ name: "", channel: "whatsapp", subject: "", body: "" })}
            >
              Novo modelo
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.templates.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {t.name} <Badge tone={t.channel === "email" ? "amber" : "green"}>{t.channel}</Badge>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.body}</p>
                </div>
                <button className="btn-sub btn-sm" onClick={() => setTplEdit(t)}>
                  Editar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "usuarios" && (
        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">Usuarios do CRM</h3>
            <button
              className="btn-primary btn-sm"
              disabled={!isAdmin}
              onClick={() => setUserEdit({ name: "", email: "", role: "staff", password: "" })}
            >
              Novo usuario
            </button>
          </div>
          <table className="w-full">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Nome</th>
                <th className="th">E-mail</th>
                <th className="th">Perfil</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.users.map((u) => (
                <tr key={u.id} className="row-hover">
                  <td className="td font-medium text-slate-800">{u.name}</td>
                  <td className="td text-slate-600">{u.email}</td>
                  <td className="td">
                    <Badge tone={u.role === "admin" ? "indigo" : u.role === "staff" ? "blue" : "slate"}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="td text-right">
                    {isAdmin && (
                      <button className="btn-sub btn-sm" onClick={() => { setPwdFor(u); setNewPwd(""); }}>
                        Trocar senha
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">
            Perfis: <b>admin</b> (tudo), <b>staff</b> (opera o CRM, sem configuracoes sensiveis),{" "}
            <b>viewer</b> (somente leitura).
          </p>
        </div>
      )}

      {tab === "dados" && (
        <div className="space-y-4">
          <div className="card-pad">
            <h3 className="text-[15px] font-semibold text-slate-900">Armazenamento</h3>
            <div className="mt-3 flex items-center gap-3">
              <Badge tone={storage === "postgres" ? "green" : "amber"}>
                {storage === "postgres" ? "Postgres conectado" : "Modo demonstracao (memoria)"}
              </Badge>
            </div>
            {storage === "memoria" ? (
              <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
                <p>
                  <b>Os dados nao estao sendo salvos de forma permanente.</b> Para ativar a
                  persistencia, conecte um banco Postgres:
                </p>
                <ol className="ml-4 list-decimal space-y-1">
                  <li>No painel da Vercel, abra o projeto e va em <b>Storage</b>.</li>
                  <li>Crie/conecte um banco <b>Neon Postgres</b> (plano gratuito serve).</li>
                  <li>
                    A Vercel injeta a variavel <code className="rounded bg-white px-1">DATABASE_URL</code>{" "}
                    automaticamente.
                  </li>
                  <li>Faca um novo deploy. As tabelas sao criadas sozinhas no primeiro acesso.</li>
                </ol>
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-slate-600">
                Os dados estao gravados no Postgres. As tabelas sao criadas automaticamente.
              </p>
            )}
          </div>

          <div className="card-pad">
            <h3 className="text-[15px] font-semibold text-slate-900">Backup e restauracao</h3>
            <p className="mt-1 text-[13px] text-slate-600">
              Exporte um arquivo JSON com todo o conteudo do CRM.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `backup-crm-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                }}
              >
                Baixar backup (JSON)
              </button>
              {isAdmin && (
                <ConfirmButton
                  className="btn-danger btn-sm"
                  message="Isso apaga TODOS os dados e recria a base de demonstracao. Continuar?"
                  onConfirm={async () => {
                    await resetDemo();
                    toast("Base reiniciada com dados de exemplo.");
                  }}
                >
                  Reiniciar com dados de exemplo
                </ConfirmButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------- Modais ------------------------------- */}

      <Modal
        open={!!stageEdit}
        onClose={() => setStageEdit(null)}
        title={stageEdit?.id ? "Editar etapa" : "Nova etapa"}
        footer={
          <>
            {stageEdit?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                message="Excluir esta etapa? Negocios nela ficarao sem etapa."
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "stages", id: stageEdit.id! });
                  setStageEdit(null);
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setStageEdit(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!stageEdit?.name?.trim()) return toast("Informe o nome.", "erro");
                await mutate({ type: "upsert", collection: "stages", item: stageEdit as Record<string, unknown> });
                setStageEdit(null);
                toast("Etapa salva.");
              }}
            >
              Salvar
            </button>
          </>
        }
      >
        {stageEdit && (
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={stageEdit.name || ""} onChange={(e) => setStageEdit({ ...stageEdit, name: e.target.value })} />
            </Field>
            <Field label="Cor">
              <input
                type="color"
                value={stageEdit.color || "#6366f1"}
                onChange={(e) => setStageEdit({ ...stageEdit, color: e.target.value })}
                className="h-10 w-full cursor-pointer rounded-lg border border-slate-300"
              />
            </Field>
            <Field label="Tipo" hint="Ganho e perdido fecham o negocio automaticamente.">
              <Select
                value={stageEdit.kind || "open"}
                onChange={(e) => setStageEdit({ ...stageEdit, kind: e.target.value as Stage["kind"] })}
              >
                <option value="open">Em andamento</option>
                <option value="won">Ganho</option>
                <option value="lost">Perdido</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!tagEdit}
        onClose={() => setTagEdit(null)}
        title={tagEdit?.id ? "Editar etiqueta" : "Nova etiqueta"}
        footer={
          <>
            {tagEdit?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "tags", id: tagEdit.id! });
                  setTagEdit(null);
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setTagEdit(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!tagEdit?.name?.trim()) return toast("Informe o nome.", "erro");
                await mutate({ type: "upsert", collection: "tags", item: tagEdit as Record<string, unknown> });
                setTagEdit(null);
              }}
            >
              Salvar
            </button>
          </>
        }
      >
        {tagEdit && (
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={tagEdit.name || ""} onChange={(e) => setTagEdit({ ...tagEdit, name: e.target.value })} />
            </Field>
            <Field label="Cor">
              <input
                type="color"
                value={tagEdit.color || "#0ea5e9"}
                onChange={(e) => setTagEdit({ ...tagEdit, color: e.target.value })}
                className="h-10 w-full cursor-pointer rounded-lg border border-slate-300"
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!fieldEdit}
        onClose={() => setFieldEdit(null)}
        title={fieldEdit?.id ? "Editar campo" : "Novo campo personalizado"}
        footer={
          <>
            {fieldEdit?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "customFields", id: fieldEdit.id! });
                  setFieldEdit(null);
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setFieldEdit(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!fieldEdit?.label?.trim()) return toast("Informe o rotulo.", "erro");
                const key =
                  fieldEdit.key?.trim() ||
                  slugify(fieldEdit.label).replace(/-/g, "_");
                await mutate({
                  type: "upsert",
                  collection: "customFields",
                  item: { ...fieldEdit, key } as Record<string, unknown>,
                });
                setFieldEdit(null);
              }}
            >
              Salvar
            </button>
          </>
        }
      >
        {fieldEdit && (
          <div className="space-y-3">
            <Field label="Rotulo">
              <Input value={fieldEdit.label || ""} onChange={(e) => setFieldEdit({ ...fieldEdit, label: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select
                value={fieldEdit.type || "text"}
                onChange={(e) => setFieldEdit({ ...fieldEdit, type: e.target.value as CustomField["type"] })}
              >
                <option value="text">Texto</option>
                <option value="textarea">Texto longo</option>
                <option value="number">Numero</option>
                <option value="date">Data</option>
                <option value="select">Lista de opcoes</option>
                <option value="checkbox">Sim / nao</option>
              </Select>
            </Field>
            {fieldEdit.type === "select" && (
              <Field label="Opcoes (uma por linha)">
                <Textarea
                  rows={4}
                  value={(fieldEdit.options || []).join("\n")}
                  onChange={(e) =>
                    setFieldEdit({
                      ...fieldEdit,
                      options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={fieldEdit.showOnForm !== false}
                onChange={(e) => setFieldEdit({ ...fieldEdit, showOnForm: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Mostrar no formulario publico de inscricao
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(fieldEdit.required)}
                onChange={(e) => setFieldEdit({ ...fieldEdit, required: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Obrigatorio no formulario
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={!!tplEdit}
        onClose={() => setTplEdit(null)}
        title={tplEdit?.id ? "Editar modelo" : "Novo modelo"}
        wide
        footer={
          <>
            {tplEdit?.id && (
              <ConfirmButton
                className="btn-danger btn-sm mr-auto"
                onConfirm={async () => {
                  await mutate({ type: "remove", collection: "templates", id: tplEdit.id! });
                  setTplEdit(null);
                }}
              >
                Excluir
              </ConfirmButton>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setTplEdit(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!tplEdit?.name?.trim()) return toast("Informe o nome.", "erro");
                await mutate({ type: "upsert", collection: "templates", item: tplEdit as Record<string, unknown> });
                setTplEdit(null);
                toast("Modelo salvo.");
              }}
            >
              Salvar
            </button>
          </>
        }
      >
        {tplEdit && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome">
                <Input value={tplEdit.name || ""} onChange={(e) => setTplEdit({ ...tplEdit, name: e.target.value })} />
              </Field>
              <Field label="Canal">
                <Select
                  value={tplEdit.channel || "whatsapp"}
                  onChange={(e) => setTplEdit({ ...tplEdit, channel: e.target.value as Template["channel"] })}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                </Select>
              </Field>
            </div>
            {tplEdit.channel === "email" && (
              <Field label="Assunto">
                <Input value={tplEdit.subject || ""} onChange={(e) => setTplEdit({ ...tplEdit, subject: e.target.value })} />
              </Field>
            )}
            <Field
              label="Mensagem"
              hint="Use {{nome}}, {{escola}}, {{curso}}, {{turma}}, {{inicio}}, {{local}}, {{link}}, {{frequencia}}"
            >
              <Textarea rows={8} value={tplEdit.body || ""} onChange={(e) => setTplEdit({ ...tplEdit, body: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!userEdit}
        onClose={() => setUserEdit(null)}
        title="Novo usuario"
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setUserEdit(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!userEdit?.name || !userEdit.email || !userEdit.password)
                  return toast("Preencha nome, e-mail e senha.", "erro");
                if (userEdit.password.length < 6) return toast("A senha precisa de 6+ caracteres.", "erro");
                try {
                  await mutate({
                    type: "user.create",
                    name: userEdit.name,
                    email: userEdit.email,
                    role: userEdit.role,
                    password: userEdit.password,
                  });
                  setUserEdit(null);
                  toast("Usuario criado.");
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Erro.", "erro");
                }
              }}
            >
              Criar usuario
            </button>
          </>
        }
      >
        {userEdit && (
          <div className="space-y-3">
            <Field label="Nome">
              <Input value={userEdit.name} onChange={(e) => setUserEdit({ ...userEdit, name: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={userEdit.email} onChange={(e) => setUserEdit({ ...userEdit, email: e.target.value })} />
            </Field>
            <Field label="Perfil">
              <Select
                value={userEdit.role}
                onChange={(e) => setUserEdit({ ...userEdit, role: e.target.value as User["role"] })}
              >
                <option value="admin">Administrador</option>
                <option value="staff">Operacional</option>
                <option value="viewer">Somente leitura</option>
              </Select>
            </Field>
            <Field label="Senha inicial">
              <Input
                type="text"
                value={userEdit.password}
                onChange={(e) => setUserEdit({ ...userEdit, password: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!pwdFor}
        onClose={() => setPwdFor(null)}
        title={`Trocar senha de ${pwdFor?.name || ""}`}
        footer={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setPwdFor(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={async () => {
                if (newPwd.length < 6) return toast("A senha precisa de 6+ caracteres.", "erro");
                await mutate({ type: "user.password", id: pwdFor!.id, password: newPwd });
                setPwdFor(null);
                toast("Senha atualizada.");
              }}
            >
              Salvar senha
            </button>
          </>
        }
      >
        <Field label="Nova senha">
          <Input type="text" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
