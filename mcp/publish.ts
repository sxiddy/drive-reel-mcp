import fs from "node:fs";
import path from "node:path";
import { planAssetPaths, type EditPlan } from "../shared/plan";
import type { MediaItem, MediaManifest } from "../shared/media";
import type { Analysis } from "./analyze";

export type PublishMeta = {
  title: string;
  themeName: string;
  pitch?: string;
  /** The theme's story arc and why it suits the occasion, shown on the watch page. */
  story?: string;
  occasionFit?: string;
  occasion: string;
  source?: string;
};

export type Published = { id: string; url: string; editUrl: string };

export const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Upload budget for media the first cut doesn't use (so the editor can swap it in). */
const EXTRA_MEDIA_BYTES = 1.2e9;

/**
 * Everything the analysis found, so the website's media bin can offer clips and photos the first
 * cut didn't use. The plan's own assets always come first.
 */
export function buildManifest(plan: EditPlan, analysis: Analysis | null): MediaManifest {
  const items: MediaItem[] = [];
  for (const c of analysis?.clips ?? []) {
    items.push({
      id: c.id,
      kind: "video",
      src: c.proxy,
      name: c.name,
      duration: c.duration,
      width: c.width,
      height: c.height,
      sheet: c.sheet,
      sheetTimes: c.sheetTimes,
      highlights: c.highlights.map((h) => h.start),
      label: c.notes,
    });
  }
  for (const p of analysis?.photos ?? []) items.push({ id: p.id, kind: "image", src: p.proxy, name: p.name, width: p.width, height: p.height, label: p.notes });
  for (const a of analysis?.audio ?? []) items.push({ id: a.id, kind: "audio", src: a.proxy, name: a.name, duration: a.duration, bpm: a.bpm, label: a.bpm ? `${a.bpm} BPM` : undefined });
  if (plan.music && !items.some((i) => i.src === plan.music!.src)) {
    items.push({ id: "music", kind: "audio", src: plan.music.src, name: plan.music.credit ?? "Soundtrack", duration: plan.music.duration, bpm: plan.music.bpm, label: `${plan.music.credit ?? "Soundtrack"} · ${plan.music.bpm} BPM` });
  }
  for (const s of plan.scenes) {
    if (s.kind === "card" && s.image && !items.some((i) => i.src === s.image)) items.push({ id: `img-${s.id}`, kind: "image", src: s.image, name: path.basename(s.image) });
  }
  return { version: 1, items };
}

/**
 * Uploads the rendered video, its poster, its edit plan and its media to the website, so the site
 * can play it and its editor can re-render it or swap in footage the first cut didn't use.
 */
export async function publishVideo(opts: {
  plan: EditPlan;
  meta: PublishMeta;
  videoFile: string;
  posterFile: string;
  assetDir: string;
  manifest: MediaManifest;
}): Promise<Published> {
  const form = new FormData();
  form.set("plan", JSON.stringify(opts.plan));
  form.set("meta", JSON.stringify(opts.meta));
  form.set("video", await fs.openAsBlob(opts.videoFile, { type: "video/mp4" }), "video.mp4");
  form.set("poster", await fs.openAsBlob(opts.posterFile, { type: "image/jpeg" }), "poster.jpg");

  const required = new Set(planAssetPaths(opts.plan));
  const optional = opts.manifest.items.flatMap((i) => [i.src, ...(i.sheet ? [i.sheet] : [])]).filter((p) => !required.has(p));
  let extraBytes = 0;
  const shipped = new Set<string>();
  for (const rel of [...required, ...new Set(optional)]) {
    const file = path.join(opts.assetDir, rel);
    if (shipped.has(rel) || !fs.existsSync(file)) continue;
    if (!required.has(rel)) {
      extraBytes += fs.statSync(file).size;
      if (extraBytes > EXTRA_MEDIA_BYTES) continue;
    }
    form.append("assets", await fs.openAsBlob(file), rel);
    shipped.add(rel);
  }
  // Only list media that actually made it to the site.
  const manifest: MediaManifest = { ...opts.manifest, items: opts.manifest.items.filter((i) => shipped.has(i.src)).map((i) => (i.sheet && !shipped.has(i.sheet) ? { ...i, sheet: undefined, sheetTimes: undefined } : i)) };
  form.set("media", JSON.stringify(manifest));

  let res: Response;
  try {
    res = await fetch(`${siteUrl()}/api/videos`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${process.env.PUBLISH_TOKEN ?? ""}` },
    });
  } catch (e) {
    throw new Error(`Could not reach the website at ${siteUrl()} (${(e as Error).message}). Start it with "npm run dev" and call generate_video again.`);
  }
  if (!res.ok) throw new Error(`Website rejected the upload (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { id: string; editKey?: string };
  return { id: j.id, url: `${siteUrl()}/v/${j.id}`, editUrl: `${siteUrl()}/v/${j.id}/edit${j.editKey ? `?key=${j.editKey}` : ""}` };
}
