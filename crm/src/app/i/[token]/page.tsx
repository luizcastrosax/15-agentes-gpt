"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { WEEKDAYS, brl, fmtDate } from "@/lib/shared";

interface FormData {
  org: { name: string; tagline: string; primaryColor: string; logoText: string; phone: string; email: string };
  form: {
    headline: string;
    subheadline: string;
    successMessage: string;
    askDocument: boolean;
    askBirthDate: boolean;
    askAddress: boolean;
    askCompany: boolean;
    askHowFound: boolean;
    requirePhone: boolean;
    lgpdText: string;
    sourceOptions: string[];
  };
  customFields: { id: string; label: string; key: string; type: string; options: string[]; required: boolean }[];
  open: boolean;
  seatsLeft: number;
  klass: {
    name: string;
    teacher: string;
    location: string;
    startDate: string;
    endDate: string;
    weekDays: number[];
    startTime: string;
    endTime: string;
    price: number;
    status: string;
  };
  course: { name: string; description: string; hours: number; modality: string; category: string } | null;
}

export default function EnrollPage() {
  const params = useParams<{ token: string }>();
  const [info, setInfo] = useState<FormData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ portalToken: string } | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/form/${params.token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setInfo(json);
      })
      .catch(() => setError("Nao foi possivel carregar o formulario."))
      .finally(() => setLoading(false));
  }, [params.token]);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/public/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token, ...values, custom, consent }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setDone({ portalToken: json.portalToken });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Falha de conexao. Tente novamente.");
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

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card-pad max-w-sm text-center">
          <p className="text-lg font-semibold text-slate-900">Link indisponivel</p>
          <p className="mt-1 text-sm text-slate-600">{error || "Este link de inscricao nao existe."}</p>
        </div>
      </div>
    );
  }

  const brand = info.org.primaryColor || "#4f46e5";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: brand }}
          >
            {info.org.logoText || "CRM"}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{info.org.name}</p>
            <p className="text-xs text-slate-500">{info.org.tagline}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {done ? (
          <div className="card-pad text-center">
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-white"
              style={{ background: brand }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Inscricao confirmada!</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{info.form.successMessage}</p>
            <div className="mt-5 rounded-lg bg-slate-50 p-4 text-left">
              <p className="text-[13px] font-medium text-slate-700">Seu portal do aluno</p>
              <p className="mt-1 text-xs text-slate-500">
                Guarde este link para acompanhar aulas, frequencia e pagamentos:
              </p>
              <a
                href={`/portal/${done.portalToken}`}
                className="mt-2 block break-all text-[13px] font-medium text-indigo-600 hover:underline"
              >
                {typeof window !== "undefined" ? window.location.origin : ""}/portal/{done.portalToken}
              </a>
            </div>
            {info.org.phone && (
              <p className="mt-4 text-[13px] text-slate-500">
                Duvidas? Fale com a gente: {info.org.phone}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="card-pad mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: brand }}>
                {info.course?.category || "Curso"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                {info.course?.name || info.klass.name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{info.course?.description}</p>

              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[11px] text-slate-500">Turma</p>
                  <p className="text-[13px] font-medium text-slate-800">{info.klass.name}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Inicio</p>
                  <p className="text-[13px] font-medium text-slate-800">{fmtDate(info.klass.startDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Encontros</p>
                  <p className="text-[13px] font-medium text-slate-800">
                    {info.klass.weekDays.map((d) => WEEKDAYS[d]).join(", ")} - {info.klass.startTime} as{" "}
                    {info.klass.endTime}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Investimento</p>
                  <p className="text-[13px] font-medium text-slate-800">
                    {info.klass.price ? brl(info.klass.price) : "Consulte"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Professor</p>
                  <p className="text-[13px] font-medium text-slate-800">{info.klass.teacher || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Local</p>
                  <p className="text-[13px] font-medium text-slate-800">{info.klass.location || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Carga horaria</p>
                  <p className="text-[13px] font-medium text-slate-800">
                    {info.course?.hours ? `${info.course.hours}h` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Vagas restantes</p>
                  <p className="text-[13px] font-medium text-slate-800">{info.seatsLeft}</p>
                </div>
              </div>
            </div>

            {!info.open ? (
              <div className="card-pad text-center">
                <p className="text-base font-semibold text-slate-900">Inscricoes encerradas</p>
                <p className="mt-1 text-sm text-slate-600">
                  As inscricoes para esta turma nao estao mais disponiveis. Entre em contato para saber
                  das proximas turmas.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="card-pad space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{info.form.headline}</h2>
                  <p className="text-sm text-slate-500">{info.form.subheadline}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label">Nome completo *</label>
                    <input
                      className="input"
                      required
                      value={values.name || ""}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">E-mail *</label>
                    <input
                      className="input"
                      type="email"
                      required
                      value={values.email || ""}
                      onChange={(e) => set("email", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">WhatsApp {info.form.requirePhone ? "*" : ""}</label>
                    <input
                      className="input"
                      required={info.form.requirePhone}
                      placeholder="(11) 99999-9999"
                      value={values.phone || ""}
                      onChange={(e) => set("phone", e.target.value)}
                    />
                  </div>
                  {info.form.askDocument && (
                    <div>
                      <label className="label">CPF</label>
                      <input
                        className="input"
                        value={values.document || ""}
                        onChange={(e) => set("document", e.target.value)}
                      />
                    </div>
                  )}
                  {info.form.askBirthDate && (
                    <div>
                      <label className="label">Data de nascimento</label>
                      <input
                        className="input"
                        type="date"
                        value={values.birthDate || ""}
                        onChange={(e) => set("birthDate", e.target.value)}
                      />
                    </div>
                  )}
                  {info.form.askCompany && (
                    <>
                      <div>
                        <label className="label">Empresa</label>
                        <input
                          className="input"
                          value={values.company || ""}
                          onChange={(e) => set("company", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Cargo</label>
                        <input
                          className="input"
                          value={values.jobTitle || ""}
                          onChange={(e) => set("jobTitle", e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  {info.form.askAddress && (
                    <>
                      <div className="sm:col-span-2">
                        <label className="label">Endereco</label>
                        <input
                          className="input"
                          value={values.address || ""}
                          onChange={(e) => set("address", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Cidade</label>
                        <input
                          className="input"
                          value={values.city || ""}
                          onChange={(e) => set("city", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Estado</label>
                        <input
                          className="input"
                          maxLength={2}
                          value={values.state || ""}
                          onChange={(e) => set("state", e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  {info.form.askHowFound && (
                    <div className="sm:col-span-2">
                      <label className="label">Como conheceu o curso?</label>
                      <select
                        className="input"
                        value={values.source || ""}
                        onChange={(e) => set("source", e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {info.form.sourceOptions.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {info.customFields.map((f) => (
                    <div key={f.id} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                      <label className="label">
                        {f.label} {f.required ? "*" : ""}
                      </label>
                      {f.type === "select" ? (
                        <select
                          className="input"
                          required={f.required}
                          value={custom[f.key] || ""}
                          onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })}
                        >
                          <option value="">Selecione...</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea
                          className="input"
                          rows={3}
                          required={f.required}
                          value={custom[f.key] || ""}
                          onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })}
                        />
                      ) : (
                        <input
                          className="input"
                          type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                          required={f.required}
                          value={custom[f.key] || ""}
                          onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}

                  <div className="sm:col-span-2">
                    <label className="label">Alguma duvida ou observacao?</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={values.message || ""}
                      onChange={(e) => set("message", e.target.value)}
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600"
                    required
                  />
                  {info.form.lgpdText}
                </label>

                {error && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                )}

                <button
                  className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
                  style={{ background: brand }}
                  disabled={sending}
                >
                  {sending ? "Enviando..." : "Confirmar inscricao"}
                </button>
                <p className="text-center text-[11px] text-slate-400">
                  Seus dados sao usados apenas para o processo de matricula.
                </p>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
