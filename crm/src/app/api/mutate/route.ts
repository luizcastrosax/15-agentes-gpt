import { NextResponse } from "next/server";
import { STORAGE_MODE, resetToSeed, withData } from "@/lib/db";
import { currentUser, publicUser } from "@/lib/auth";
import { type Action, applyAction, sanitize } from "@/lib/mutations";
import { readData } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "nao-autenticado" }, { status: 401 });
  if (user.role === "viewer") {
    return NextResponse.json({ error: "Seu perfil e somente leitura." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { actions?: Action[]; reset?: boolean };

  if (body.reset) {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
    }
    await resetToSeed();
    const data = await readData();
    return NextResponse.json({ storage: STORAGE_MODE, user: publicUser(user), data: sanitize(data) });
  }

  const actions = body.actions || [];
  if (!actions.length) return NextResponse.json({ error: "Nenhuma acao enviada." }, { status: 400 });

  const restricted = new Set(["user.create", "user.password", "settings.org"]);
  if (user.role !== "admin" && actions.some((a) => restricted.has(a.type))) {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  try {
    const results: unknown[] = [];
    const data = await withData((draft) => {
      results.length = 0;
      for (const action of actions) {
        results.push(applyAction(draft, action, { actor: user.name }));
      }
      return draft;
    });
    return NextResponse.json({
      results,
      storage: STORAGE_MODE,
      user: publicUser(user),
      data: sanitize(data),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao gravar.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
