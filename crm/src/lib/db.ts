import { neon } from "@neondatabase/serverless";
import type { CrmData } from "./types";
import { buildSeed } from "./seed";

/**
 * Persistencia do CRM.
 *
 * O estado inteiro e guardado como um documento JSON (a base de um curso cabe
 * folgada em um documento). Isso permite dois backends com a mesma interface:
 *
 *  - Postgres (Neon / Vercel Postgres): usado quando existe DATABASE_URL.
 *    Persistente de verdade, com trava otimista por versao.
 *  - Memoria: fallback quando nao ha banco configurado. O app funciona 100%,
 *    mas os dados somem quando a funcao serverless recicla (modo demonstracao).
 */

const DOC_ID = "main";

export const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

export const STORAGE_MODE: "postgres" | "memoria" = DATABASE_URL ? "postgres" : "memoria";

/** True quando nenhuma ADMIN_PASSWORD foi definida (base criada com a senha padrao). */
export const USING_DEFAULT_PASSWORD = !process.env.ADMIN_PASSWORD;

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "admin123";
}

/* ------------------------------ backend memoria --------------------------- */

type MemoryCell = { doc: CrmData; version: number } | null;
const globalMem = globalThis as unknown as { __crmMemory?: MemoryCell };

function memRead(): { doc: CrmData; version: number } {
  if (!globalMem.__crmMemory) {
    globalMem.__crmMemory = { doc: buildSeed(adminPassword()), version: 1 };
  }
  return globalMem.__crmMemory;
}

/* ------------------------------ backend postgres -------------------------- */

let schemaReady = false;

function sql() {
  return neon(DATABASE_URL);
}

async function ensureSchema() {
  if (schemaReady) return;
  const q = sql();
  await q`
    CREATE TABLE IF NOT EXISTS crm_doc (
      id text PRIMARY KEY,
      doc jsonb NOT NULL,
      version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  schemaReady = true;
}

async function pgRead(): Promise<{ doc: CrmData; version: number }> {
  await ensureSchema();
  const q = sql();
  const rows = (await q`SELECT doc, version FROM crm_doc WHERE id = ${DOC_ID}`) as Array<{
    doc: CrmData;
    version: number;
  }>;
  if (rows.length) return { doc: rows[0].doc, version: rows[0].version };

  const seed = buildSeed(adminPassword());
  await q`
    INSERT INTO crm_doc (id, doc, version) VALUES (${DOC_ID}, ${JSON.stringify(seed)}::jsonb, 1)
    ON CONFLICT (id) DO NOTHING
  `;
  const again = (await q`SELECT doc, version FROM crm_doc WHERE id = ${DOC_ID}`) as Array<{
    doc: CrmData;
    version: number;
  }>;
  return again.length ? { doc: again[0].doc, version: again[0].version } : { doc: seed, version: 1 };
}

async function pgWrite(doc: CrmData, expectedVersion: number): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    UPDATE crm_doc
       SET doc = ${JSON.stringify(doc)}::jsonb,
           version = version + 1,
           updated_at = now()
     WHERE id = ${DOC_ID} AND version = ${expectedVersion}
     RETURNING version
  `) as Array<{ version: number }>;
  return rows.length > 0;
}

/* --------------------------------- API ------------------------------------ */

export async function readData(): Promise<CrmData> {
  if (STORAGE_MODE === "postgres") return (await pgRead()).doc;
  return memRead().doc;
}

/**
 * Le o documento, aplica a mutacao e grava. Em caso de escrita concorrente,
 * recarrega e tenta de novo (trava otimista).
 */
export async function withData<T>(fn: (data: CrmData) => T | Promise<T>): Promise<T> {
  if (STORAGE_MODE === "memoria") {
    const cell = memRead();
    const result = await fn(cell.doc);
    cell.version += 1;
    return result;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { doc, version } = await pgRead();
    const result = await fn(doc);
    try {
      const ok = await pgWrite(doc, version);
      if (ok) return result;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
  }
  throw lastError || new Error("Nao foi possivel gravar: conflito de concorrencia.");
}

/** Substitui o documento inteiro (usado por reset/importacao). */
export async function replaceData(doc: CrmData): Promise<void> {
  if (STORAGE_MODE === "memoria") {
    globalMem.__crmMemory = { doc, version: (globalMem.__crmMemory?.version || 0) + 1 };
    return;
  }
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO crm_doc (id, doc, version) VALUES (${DOC_ID}, ${JSON.stringify(doc)}::jsonb, 1)
    ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, version = crm_doc.version + 1, updated_at = now()
  `;
}

export async function resetToSeed(): Promise<void> {
  await replaceData(buildSeed(adminPassword()));
}
