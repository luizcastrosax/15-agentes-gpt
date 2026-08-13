"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@crm.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Nao foi possivel conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-lg shadow-indigo-200">
            CRM
          </div>
          <h1 className="text-xl font-semibold text-slate-900">CRM do Curso</h1>
          <p className="mt-1 text-sm text-slate-500">
            Matriculas, presenca, funil de vendas e financeiro.
          </p>
        </div>

        <form onSubmit={submit} className="card-pad space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Sua senha"
              required
            />
          </div>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          Acesso inicial: <b>admin@crm.local</b> com a senha definida na variavel{" "}
          <code className="rounded bg-slate-100 px-1">ADMIN_PASSWORD</code> (padrao{" "}
          <code className="rounded bg-slate-100 px-1">admin123</code>).
        </p>
      </div>
    </div>
  );
}
