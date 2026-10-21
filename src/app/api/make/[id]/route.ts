import { isMakeId } from "@/shared/make";
import { liveStatus, publicStatus } from "@/src/lib/make";

export const runtime = "nodejs";

/** Progress of a website job. The long random id is the only key, so it's safe to show its result. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = isMakeId(id) ? liveStatus(id) : null;
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(publicStatus(s), { headers: { "Cache-Control": "no-store" } });
}
