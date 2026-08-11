import { NextResponse } from "next/server";
import { STORAGE_MODE, readData } from "@/lib/db";
import { currentUser, publicUser } from "@/lib/auth";
import { sanitize } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "nao-autenticado" }, { status: 401 });
  const data = await readData();
  return NextResponse.json({
    user: publicUser(user),
    storage: STORAGE_MODE,
    data: sanitize(data),
  });
}
