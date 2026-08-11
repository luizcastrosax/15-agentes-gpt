"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Action } from "@/lib/mutations";
import type { CrmData, Role } from "@/lib/types";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface Ctx {
  data: CrmData;
  user: SessionUser;
  storage: "postgres" | "memoria";
  loading: boolean;
  busy: boolean;
  mutate: (actions: Action | Action[]) => Promise<unknown[]>;
  reload: () => Promise<void>;
  resetDemo: () => Promise<void>;
  baseUrl: string;
}

const DataCtx = createContext<Ctx | null>(null);

export function useCrm(): Ctx {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useCrm precisa estar dentro de <DataProvider>");
  return ctx;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<CrmData | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [storage, setStorage] = useState<"postgres" | "memoria">("memoria");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const json = await res.json();
    if (json.error) {
      setError(json.error);
      return;
    }
    setData(json.data);
    setUser(json.user);
    setStorage(json.storage);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (actions: Action | Action[]) => {
      const list = Array.isArray(actions) ? actions : [actions];
      setBusy(true);
      try {
        const res = await fetch("/api/mutate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: list }),
        });
        if (res.status === 401) {
          router.replace("/login");
          throw new Error("Sessao expirada.");
        }
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setData(json.data);
        setStorage(json.storage);
        return json.results as unknown[];
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const resetDemo = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json.data);
    } finally {
      setBusy(false);
    }
  }, []);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const value = useMemo<Ctx | null>(
    () =>
      data && user
        ? { data, user, storage, loading, busy, mutate, reload: load, resetDemo, baseUrl }
        : null,
    [data, user, storage, loading, busy, mutate, load, resetDemo, baseUrl],
  );

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card-pad max-w-md text-center">
          <p className="text-sm font-semibold text-rose-600">Erro ao carregar o CRM</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
          <button className="btn-primary btn-sm mt-4" onClick={() => location.reload()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    );
  }

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
