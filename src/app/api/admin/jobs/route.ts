import crypto from "node:crypto";
import fs from "node:fs";
import { isMakeId } from "@/shared/make";
import { PROJECTS, liveStatus } from "@/src/lib/make";
import { listVideos } from "@/src/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Site-owner only: every website job and published video. Needs `Authorization: Bearer <PUBLISH_TOKEN>`. */
export async function GET(req: Request) {
  const want = process.env.PUBLISH_TOKEN;
  // With no token configured there is no owner, so nobody gets in.
  if (!want || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${want}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const jobs = (fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : [])
    .filter(isMakeId)
    .map((id) => liveStatus(id))
    .filter((s) => s !== null)
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      step: s.step,
      stage: s.stage,
      progress: s.progress,
      error: s.error,
      input: s.input,
      stats: s.stats,
      chosen: s.themes?.find((t) => t.id === s.chosen)?.name,
      videoId: s.result?.videoId,
      footageCleared: s.footageCleared ?? false,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const videos = listVideos().map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt, versions: m.versions.length, occasion: m.occasion, source: m.source }));
  return Response.json({ jobs, videos }, { headers: { "cache-control": "no-store" } });
}

function sameSecret(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
