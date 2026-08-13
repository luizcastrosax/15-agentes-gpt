"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fmtDate } from "@/lib/shared";

interface Info {
  org: { name: string; primaryColor: string; logoText: string };
  open: boolean;
  session: { date: string; startTime: string; endTime: string; topic: string; teacher: string };
  className: string;
  courseName: string;
}

export default function CheckinPage() {
  const params = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    fetch(`/api/public/checkin/${params.token}`)
      .then((r) => r.json())
      .then((json) => (json.error ? setError(json.error) : setInfo(json)))
      .catch(() => setError("Nao foi possivel carregar a aula."))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/public/checkin/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setOk(json.name);
    } catch {
      setError("Falha de conexao.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    );
  }

  const brand = info?.org.primaryColor || "#4f46e5";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        {info && (
          <div className="mb-5 text-center">
            <span
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ background: brand }}
            >
              {info.org.logoText || "CRM"}
            </span>
            <h1 className="text-lg font-semibold text-slate-900">Confirmar presenca</h1>
            <p className="mt-1 text-sm text-slate-500">
              {info.courseName} - {info.className}
            </p>
          </div>
        )}

        <div className="card-pad">
          {ok ? (
            <div className="text-center">
              <div
                className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-white"
                style={{ background: "#16a34a" }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <p className="text-base font-semibold text-slate-900">Presenca registrada!</p>
              <p className="mt-1 text-sm text-slate-600">
                Bom curso, {ok.split(" ")[0]}. Sua presenca foi confirmada.
              </p>
            </div>
          ) : !info ? (
            <p className="text-center text-sm text-slate-600">{error || "Aula nao encontrada."}</p>
          ) : !info.open ? (
            <div className="text-center">
              <p className="text-base font-semibold text-slate-900">Chamada fechada</p>
              <p className="mt-1 text-sm text-slate-600">
                O check-in desta aula nao esta liberado. Fale com o professor.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-[13px]">
                <p className="font-medium text-slate-800">{info.session.topic || "Aula"}</p>
                <p className="text-slate-500">
                  {fmtDate(info.session.date)} - {info.session.startTime} as {info.session.endTime}
                </p>
                {info.session.teacher && <p className="text-slate-500">{info.session.teacher}</p>}
              </div>

              <div>
                <label className="label">Seu e-mail ou telefone cadastrado</label>
                <input
                  className="input"
                  required
                  autoFocus
                  placeholder="voce@email.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>

              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

              <button
                className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: brand }}
                disabled={sending}
              >
                {sending ? "Confirmando..." : "Estou presente"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
