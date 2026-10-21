import { isMakeId } from "@/shared/make";
import { MakeError, publicStatus, startGenerate } from "@/src/lib/make";

export const runtime = "nodejs";

/** Renders the chosen theme: { themeId }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isMakeId(id)) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { themeId?: unknown };
  if (typeof body.themeId !== "string" || !/^t[1-4]$/.test(body.themeId)) return Response.json({ error: "Pick a theme." }, { status: 400 });
  try {
    return Response.json(publicStatus(startGenerate(id, body.themeId)));
  } catch (e) {
    if (e instanceof MakeError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
