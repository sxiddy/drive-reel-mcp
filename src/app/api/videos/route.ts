import fs from "node:fs";
import path from "node:path";
import { EditPlan, isSafeAssetPath, planDurationInFrames } from "@/shared/plan";
import { sanitizeManifest, writeMedia } from "@/src/lib/media";
import { checkPlanAssets, checkToken, listVideos, newEditKey, newId, publicMeta, safeJoin, videoDir, writeMeta, writePlan, type VideoMeta } from "@/src/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(listVideos().map(publicMeta));
}

/** Files the site itself owns in a video folder; uploads may not overwrite them. */
const RESERVED = new Set(["meta.json", "plan.json", "plan.original.json", "media.json", "renders"]);

/**
 * Publish endpoint used by the MCP server. Multipart fields:
 * plan (JSON), meta (JSON: pitch, source), video (mp4), poster (jpg), assets (files named by their
 * relative path, e.g. "assets/v3.mp4", "sheets/v3.jpg") and optional media (JSON MediaManifest).
 * Responds { id, editKey }; the edit link is /v/<id>/edit?key=<editKey>.
 */
export async function POST(req: Request) {
  if (!checkToken(req)) return new Response("unauthorized", { status: 401 });
  const form = await req.formData();
  const planRaw = form.get("plan");
  const metaRaw = form.get("meta");
  const mediaRaw = form.get("media");
  const video = form.get("video");
  const poster = form.get("poster");
  if (typeof planRaw !== "string" || typeof metaRaw !== "string" || !(video instanceof File) || !(poster instanceof File)) {
    return new Response("expected plan, meta, video and poster", { status: 400 });
  }
  let planJson: unknown, meta: Partial<VideoMeta>, mediaJson: unknown;
  try {
    planJson = JSON.parse(planRaw);
    meta = JSON.parse(metaRaw) as Partial<VideoMeta>;
    mediaJson = typeof mediaRaw === "string" && mediaRaw ? JSON.parse(mediaRaw) : null;
  } catch {
    return new Response("plan, meta and media must be JSON", { status: 400 });
  }
  const parsed = EditPlan.safeParse(planJson);
  if (!parsed.success) return new Response(`invalid plan: ${parsed.error.message}`, { status: 400 });
  const plan = parsed.data;

  const assets = form.getAll("assets").filter((e): e is File => e instanceof File);
  for (const a of assets) {
    const top = a.name.split("/")[0].toLowerCase();
    if (!isSafeAssetPath(a.name) || a.name.split("/").some((seg) => seg.startsWith(".")) || RESERVED.has(top)) {
      return new Response(`asset name not allowed: ${a.name}`, { status: 400 });
    }
  }

  const id = newId();
  const dir = videoDir(id);
  try {
    fs.mkdirSync(path.join(dir, "renders"), { recursive: true });
    for (const entry of assets) {
      const dest = safeJoin(dir, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await entry.arrayBuffer()));
    }
    // Every path the plan uses must be a plain relative path to a file that was just uploaded.
    const bad = checkPlanAssets(dir, plan);
    if (bad) throw new Response(bad, { status: 400 });

    fs.writeFileSync(path.join(dir, "renders", "v1.mp4"), Buffer.from(await video.arrayBuffer()));
    fs.writeFileSync(path.join(dir, "renders", "v1.jpg"), Buffer.from(await poster.arrayBuffer()));
    writePlan(id, plan);
    const planText = JSON.stringify({ ...plan, assetBase: "" }, null, 2);
    // Keep the original plan so the editor can offer "reset to original", and snapshot what v1 was rendered from.
    fs.writeFileSync(path.join(dir, "plan.original.json"), planText);
    fs.writeFileSync(path.join(dir, "renders", "v1.plan.json"), planText);
    if (mediaJson) writeMedia(id, sanitizeManifest(dir, mediaJson));

    const now = new Date().toISOString();
    const editKey = newEditKey();
    writeMeta({
      id,
      title: plan.title,
      themeName: plan.themeName,
      pitch: typeof meta.pitch === "string" ? meta.pitch : undefined,
      story: typeof meta.story === "string" ? meta.story.slice(0, 300) : undefined,
      occasionFit: typeof meta.occasionFit === "string" ? meta.occasionFit.slice(0, 300) : undefined,
      occasion: plan.occasion,
      source: typeof meta.source === "string" ? meta.source : undefined,
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          n: 1,
          file: "renders/v1.mp4",
          poster: "renders/v1.jpg",
          createdAt: now,
          durationSeconds: Math.round((planDurationInFrames(plan) / plan.fps) * 10) / 10,
          aspect: plan.aspect,
          plan: "renders/v1.plan.json",
        },
      ],
      render: { status: "idle", progress: 1 },
      editKey,
    });
    return Response.json({ id, editKey });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (e instanceof Response) return e;
    return new Response(`publish failed: ${(e as Error).message}`, { status: 400 });
  }
}
