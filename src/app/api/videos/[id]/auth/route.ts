import { canEditVideo, isVideoId, readMeta } from "@/src/lib/store";

export const runtime = "nodejs";

/** Tells the browser whether the edit key it holds (x-edit-key) unlocks this video. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  const ok = canEditVideo(req, id);
  return Response.json({ ok }, { status: ok ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
