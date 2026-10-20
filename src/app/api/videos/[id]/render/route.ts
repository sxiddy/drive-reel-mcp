import { canEditVideo, isVideoId, readMeta, recoverStaleRender, renderView, startRender } from "@/src/lib/store";

export const runtime = "nodejs";

/** Queues a new version from the saved plan. Needs the edit key. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  if (!canEditVideo(req, id)) return new Response("This video can only be changed with its edit link.", { status: 401 });
  return Response.json(renderView(startRender(id)));
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  if (!meta) return new Response("not found", { status: 404 });
  const m = recoverStaleRender(meta);
  return Response.json({ render: renderView(m), versions: m.versions });
}
