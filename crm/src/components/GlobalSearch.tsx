"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "./DataProvider";
import { searchMatch } from "@/lib/shared";

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useCrm();
  const router = useRouter();
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const out: { label: string; sub: string; href: string; kind: string }[] = [];
    data.contacts
      .filter((c) => searchMatch(`${c.name} ${c.email} ${c.phone}`, q))
      .slice(0, 6)
      .forEach((c) =>
        out.push({
          label: c.name,
          sub: c.email || c.phone || "Contato",
          href: `/contatos/${c.id}`,
          kind: c.status === "aluno" ? "Aluno" : "Lead",
        }),
      );
    data.classes
      .filter((c) => searchMatch(c.name, q))
      .slice(0, 4)
      .forEach((c) => out.push({ label: c.name, sub: c.teacher, href: `/turmas/${c.id}`, kind: "Turma" }));
    data.courses
      .filter((c) => searchMatch(`${c.name} ${c.code}`, q))
      .slice(0, 4)
      .forEach((c) => out.push({ label: c.name, sub: c.category, href: `/cursos`, kind: "Curso" }));
    return out;
  }, [q, data]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-24 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-in-up w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar contatos, turmas, cursos..."
            className="w-full py-3.5 text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && results[0]) {
                router.push(results[0].href);
                onClose();
              }
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!q.trim() && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Digite para buscar em todo o CRM.
            </p>
          )}
          {q.trim() && !results.length && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Nada encontrado.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.href}-${i}`}
              onClick={() => {
                router.push(r.href);
                onClose();
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
            >
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                {r.kind}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{r.label}</span>
                <span className="block truncate text-xs text-slate-500">{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
