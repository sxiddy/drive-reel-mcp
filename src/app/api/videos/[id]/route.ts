import fs from "node:fs";
import path from "node:path";
import { EditPlan } from "@/shared/plan";
import { canEditVideo, checkPlanAssets, isVideoId, publicMeta, readMeta, readPlan, recoverStaleRender, videoDir, writePlan } from "@/src/lib/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  if (!meta) return new Response("not found", { status: 404 });
  return Response.json({ meta: publicMeta(recoverStaleRender(meta)), plan: readPlan(id) });
}

/** Saves an edited plan. `?reset=1` restores the plan the video was first published with. Needs the edit key. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  if (!canEditVideo(req, id)) return new Response("This video can only be changed with its edit link.", { status: 401 });
  const dir = videoDir(id);
  if (new URL(req.url).searchParams.get("reset")) {
    const original = EditPlan.parse(JSON.parse(fs.readFileSync(path.join(dir, "plan.original.json"), "utf8")));
    writePlan(id, original);
    return Response.json({ plan: original });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("expected a JSON plan", { status: 400 });
  }
  const parsed = EditPlan.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  // Edits may only point at files inside this video's folder: no URLs (music.src included), no "..".
  const bad = checkPlanAssets(dir, parsed.data);
  if (bad) return new Response(bad, { status: 400 });
  writePlan(id, parsed.data);
  return Response.json({ ok: true });
}
