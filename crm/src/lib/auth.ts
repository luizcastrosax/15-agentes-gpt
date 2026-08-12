import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { readData } from "./db";
import type { User } from "./types";

const COOKIE = "crm_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/** True quando o cookie de sessao esta sendo assinado com o segredo de fallback. */
export const USING_DEFAULT_SECRET = !process.env.AUTH_SECRET && !process.env.ADMIN_PASSWORD;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "crm-curso-dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionValue(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSessionValue(value: string): string | null {
  const [payload, sig] = (value || "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u: string;
      t: number;
    };
    if (Date.now() - parsed.t > MAX_AGE * 1000) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE;

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const userId = readSessionValue(raw);
  if (!userId) return null;
  const data = await readData();
  const user = data.users.find((u) => u.id === userId && u.active);
  return user || null;
}

export function publicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
