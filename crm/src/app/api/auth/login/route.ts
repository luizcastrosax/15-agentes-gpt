import { NextResponse } from "next/server";
import { readData } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionValue, publicUser } from "@/lib/auth";
import { verifyPassword } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }
  const data = await readData();
  const user = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
  }
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, createSessionValue(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
