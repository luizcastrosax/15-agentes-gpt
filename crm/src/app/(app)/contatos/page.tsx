"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/components/DataProvider";
import { ContactForm, blankContact } from "@/components/ContactForm";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
} from "@/components/ui";
import {
  downloadFile,
  fmtDate,
  maskPhone,
  parseCSV,
  searchMatch,
  toCSV,
  whatsappLink,
} from "@/lib/shared";
import type { Contact } from "@/lib/types";

const STATUS_TONE: Record<string, "blue" | "green" | "purple" | "slate"> = {
  lead: "blue",
  aluno: "green",
  "ex-aluno": "purple",
  inativo: "slate",
};

export default function ContactsPage() {
  const { data, mutate } = useCrm();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<Record<string, string>[]>([]);
  const [page, setPage] = useState(1);
  const perPage = 25;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("novo")) {
      setEditing({ ...blankContact });
    }
  }, []);

  const filtered = useMemo(() => {
    return data.contacts
      .filter((c) => (showArchived ? c.archived : !c.archived))
      .filter((c) => (status ? c.status === status : true))
      .filter((c) => (tag ? c.tagIds.includes(tag) : true))
      .filter((c) => (owner ? c.ownerId === owner : true))
      .filter((c) => (source ? c.source === source : true))
      .filter((c) => searchMatch(`${c.name} ${c.email} ${c.phone} ${c.company} ${c.city}`, q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data.contacts, q, status, tag, owner, source, showArchived]);

  const pageItems = filtered.slice((page - 1) * perPage, page * perPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  useEffect(() => setPage(1), [q, status, tag, owner, source, showArchived]);

  function exportCSV() {
    const rows = filtered.map((c) => ({
      Nome: c.name,
      Email: c.email,
      Telefone: c.phone,
      CPF: c.document,
      Situacao: c.status,
      Origem: c.source,
      Empresa: c.company,
      Cidade: c.city,
      Estado: c.state,
      Etiquetas: c.tagIds.map((t) => data.tags.find((x) => x.id === t)?.name || "").join(", "),
      Responsavel: data.users.find((u) => u.id === c.ownerId)?.name || "",
      "Criado em": fmtDate(c.createdAt),
    }));
    downloadFile(`contatos-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
    toast(`${rows.length} contatos exportados.`);
  }

  async function runImport() {
    if (!importPreview.length) return;
    const [res] = (await mutate({ type: "contacts.import", rows: importPreview })) as [
      { created: number; updated: number },
    ];
    toast(`${res.created} criados e ${res.updated} atualizados.`);
    setImportOpen(false);
    setImportPreview([]);
  }

  async function bulk(op: string, value?: string) {
    if (!selected.length) return;
    await mutate({ type: "contacts.bulk", ids: selected, op, value });
    setSelected([]);
    toast("Contatos atualizados.");
  }

  const allChecked = pageItems.length > 0 && pageItems.every((c) => selected.includes(c.id));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contatos e alunos"
        subtitle={`${filtered.length} de ${data.contacts.length} registros`}
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
              Importar CSV
            </button>
            <button className="btn-ghost btn-sm" onClick={exportCSV}>
              Exportar
            </button>
            <button className="btn-primary btn-sm" onClick={() => setEditing({ ...blankContact })}>
              Novo contato
            </button>
          </>
        }
      />

      <div className="card-pad">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Input
            placeholder="Buscar por nome, e-mail, telefone..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:col-span-2"
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas situacoes</option>
            <option value="lead">Leads</option>
            <option value="aluno">Alunos</option>
            <option value="ex-aluno">Ex-alunos</option>
            <option value="inativo">Inativos</option>
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Todas etiquetas</option>
            {data.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Todas origens</option>
            {data.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Todos responsaveis</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          Mostrar arquivados
        </label>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5">
          <span className="text-[13px] font-medium text-indigo-900">
            {selected.length} selecionado(s)
          </span>
          <Select
            className="w-auto py-1 text-[13px]"
            value=""
            onChange={(e) => e.target.value && bulk("tag", e.target.value)}
          >
            <option value="">Aplicar etiqueta...</option>
            {data.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto py-1 text-[13px]"
            value=""
            onChange={(e) => e.target.value && bulk("status", e.target.value)}
          >
            <option value="">Mudar situacao...</option>
            <option value="lead">Lead</option>
            <option value="aluno">Aluno</option>
            <option value="ex-aluno">Ex-aluno</option>
            <option value="inativo">Inativo</option>
          </Select>
          <Select
            className="w-auto py-1 text-[13px]"
            value=""
            onChange={(e) => bulk("owner", e.target.value)}
          >
            <option value="">Definir responsavel...</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <button className="btn-sub btn-sm" onClick={() => bulk(showArchived ? "unarchive" : "archive")}>
            {showArchived ? "Desarquivar" : "Arquivar"}
          </button>
          <button
            className="btn-danger btn-sm"
            onClick={() => {
              if (window.confirm(`Excluir ${selected.length} contato(s)? Matriculas, presencas e pagamentos ligados a eles tambem serao removidos.`))
                bulk("delete");
            }}
          >
            Excluir
          </button>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSelected([])}>
            Limpar
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        {pageItems.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...new Set([...selected, ...pageItems.map((c) => c.id)])]
                            : selected.filter((id) => !pageItems.some((c) => c.id === id)),
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                  </th>
                  <th className="th">Contato</th>
                  <th className="th">Situacao</th>
                  <th className="th">Telefone</th>
                  <th className="th">Origem</th>
                  <th className="th">Etiquetas</th>
                  <th className="th">Criado</th>
                  <th className="th w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((c) => (
                  <tr key={c.id} className="row-hover">
                    <td className="td">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.id]
                              : selected.filter((id) => id !== c.id),
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                    </td>
                    <td className="td">
                      <Link href={`/contatos/${c.id}`} className="flex items-center gap-2.5">
                        <Avatar name={c.name} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800 hover:text-indigo-700">
                            {c.name}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {c.email || "sem e-mail"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-slate-600">{maskPhone(c.phone) || "-"}</td>
                    <td className="td text-slate-600">{c.source || "-"}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {c.tagIds.slice(0, 2).map((id) => {
                          const t = data.tags.find((x) => x.id === id);
                          return t ? (
                            <Badge key={id} color={t.color}>
                              {t.name}
                            </Badge>
                          ) : null;
                        })}
                        {c.tagIds.length > 2 && (
                          <span className="text-[11px] text-slate-400">+{c.tagIds.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">{fmtDate(c.createdAt)}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        {c.phone && (
                          <a
                            href={whatsappLink(c.phone)}
                            target="_blank"
                            rel="noreferrer"
                            title="WhatsApp"
                            className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2a10 10 0 0 0-8.7 15l-1.2 4.4 4.5-1.2A10 10 0 1 0 12 2Zm5.3 14c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2 .2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.4-.3.4c-.1.1-.2.3 0 .5.2.3.7 1.2 1.6 1.9 1.1.9 1.6 1 1.9 1.2.2.1.4 0 .5-.1l.7-.8c.2-.2.3-.2.5-.1l2 1c.2.1.4.2.4.3.1.1.1.5-.1 1Z" />
                            </svg>
                          </a>
                        )}
                        <button
                          onClick={() => setEditing(c)}
                          title="Editar"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhum contato encontrado"
            description="Ajuste os filtros, importe uma planilha ou cadastre um contato."
            action={
              <button className="btn-primary btn-sm" onClick={() => setEditing({ ...blankContact })}>
                Novo contato
              </button>
            }
          />
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-[13px] text-slate-600">
            <span>
              Pagina {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                Proxima
              </button>
            </div>
          </div>
        )}
      </div>

      <ContactForm value={editing} onClose={() => setEditing(null)} />

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportPreview([]);
        }}
        title="Importar contatos de planilha"
        wide
        footer={
          <>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setImportOpen(false);
                setImportPreview([]);
              }}
            >
              Cancelar
            </button>
            <button className="btn-primary btn-sm" onClick={runImport} disabled={!importPreview.length}>
              Importar {importPreview.length || ""} contatos
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">
            Envie um arquivo <b>.csv</b> com uma linha de cabecalho. Colunas reconhecidas:{" "}
            <code className="rounded bg-white px-1">nome</code>,{" "}
            <code className="rounded bg-white px-1">email</code>,{" "}
            <code className="rounded bg-white px-1">telefone</code>,{" "}
            <code className="rounded bg-white px-1">cpf</code>,{" "}
            <code className="rounded bg-white px-1">cidade</code>,{" "}
            <code className="rounded bg-white px-1">estado</code>,{" "}
            <code className="rounded bg-white px-1">empresa</code>,{" "}
            <code className="rounded bg-white px-1">origem</code>. Contatos com e-mail ou telefone ja
            existente sao atualizados em vez de duplicados.
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                setImportPreview(parseCSV(text));
              }}
            />
            <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              Escolher arquivo CSV
            </button>
            <button
              className="btn-sub btn-sm"
              onClick={() =>
                downloadFile(
                  "modelo-importacao.csv",
                  "nome;email;telefone;cpf;cidade;estado;empresa;origem\nMaria Silva;maria@email.com;11999998888;;Sao Paulo;SP;;Instagram",
                )
              }
            >
              Baixar modelo
            </button>
          </div>

          {importPreview.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50">
                  <tr>
                    {Object.keys(importPreview[0]).map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importPreview.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {Object.keys(importPreview[0]).map((h) => (
                        <td key={h} className="td">
                          {r[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 5 && (
                <p className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  +{importPreview.length - 5} linhas
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
