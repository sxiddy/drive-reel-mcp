import { z } from "zod";
import { AspectRatio } from "@/shared/plan";
import { canEditVideo, isVideoId, readMeta, recoverStaleRender, RenderRequestError, renderView, startRender, startUhdRender } from "@/src/lib/store";

export const runtime = "nodejs";

const VersionNumber = z.number().int().min(1).max(9999);

/**
 * What to render. An empty body (or `{}`) renders the saved plan as a new version, as before.
 * - `{ aspect }` exports the saved plan in another frame shape (the saved plan itself is not changed).
 * - `{ aspect, from }` exports version `from`'s edit (its plan snapshot) in that frame shape.
 * - `{ version, scale: 2 }` re-renders that version in 4K and attaches it to the version.
 */
const Body = z.union([
  z.strictObject({ version: VersionNumber, scale: z.literal(2) }),
  z.strictObject({ aspect: AspectRatio.optional(), from: VersionNumber.optional() }),
]);

/** Queues a render. Needs the edit key. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  if (!canEditVideo(req, id)) return new Response("This video can only be changed with its edit link.", { status: 401 });
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return new Response("expected a JSON body", { status: 400 });
    }
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return new Response(`Bad render request: ${parsed.error.issues.map((i) => i.message).join("; ")}`, { status: 400 });
  try {
    const body = parsed.data;
    const meta = "version" in body ? startUhdRender(id, body.version) : startRender(id, body);
    return Response.json(renderView(meta));
  } catch (e) {
    if (e instanceof RenderRequestError) return new Response(e.message, { status: e.status });
    throw e;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  if (!meta) return new Response("not found", { status: 404 });
  const m = recoverStaleRender(meta);
  return Response.json({ render: renderView(m), versions: m.versions }, { headers: { "Cache-Control": "no-store" } });
}
