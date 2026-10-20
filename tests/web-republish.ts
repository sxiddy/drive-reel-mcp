/**
 * Re-publishes an existing video through POST /api/videos exactly like the MCP publisher does
 * (plan, meta, video, poster, assets incl. contact sheets, and a media.json manifest).
 * Usage: tsx tests/web-republish.ts <videoId> [siteUrl]
 * Prints the response ({ id, editKey }) and the edit link.
 */
import fs from "node:fs";
import path from "node:path";
import type { MediaItem, MediaManifest } from "../shared/media";

const [videoId, site = "http://localhost:3000"] = process.argv.slice(2);
if (!videoId) {
  console.error("usage: tsx tests/web-republish.ts <videoId> [siteUrl]");
  process.exit(2);
}

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);

const dir = path.join("data", "videos", videoId);
const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
const v = meta.versions.at(-1);

type Clip = { id: string; name: string; duration: number; width: number; height: number; proxy: string; sheet: string; sheetTimes: number[]; highlights?: { start: number }[] };
type Photo = { id: string; name: string; width: number; height: number; proxy: string };

// The analysis project whose proxies match this video's assets (it has the contact sheets and the unused media).
const used = fs.readdirSync(path.join(dir, "assets"));
let project: string | null = null;
for (const p of fs.existsSync("work/projects") ? fs.readdirSync("work/projects") : []) {
  const a = path.join("work/projects", p, "analysis.json");
  if (fs.existsSync(a) && used.every((f) => fs.existsSync(path.join("work/projects", p, "assets", f)))) {
    project = path.join("work/projects", p);
    break;
  }
}

const files = new Map<string, string>(); // published name -> local path
const items: MediaItem[] = [];
for (const f of used) files.set(`assets/${f}`, path.join(dir, "assets", f));

if (project) {
  const analysis = JSON.parse(fs.readFileSync(path.join(project, "analysis.json"), "utf8")) as { clips: Clip[]; photos: Photo[] };
  for (const c of analysis.clips) {
    files.set(c.proxy, path.join(project, c.proxy));
    if (fs.existsSync(path.join(project, c.sheet))) files.set(c.sheet, path.join(project, c.sheet));
    items.push({ id: c.id, kind: "video", src: c.proxy, name: c.name, duration: c.duration, width: c.width, height: c.height, sheet: c.sheet, sheetTimes: c.sheetTimes, highlights: (c.highlights ?? []).map((h) => h.start) });
  }
  for (const p of analysis.photos) {
    files.set(p.proxy, path.join(project, p.proxy));
    items.push({ id: p.id, kind: "image", src: p.proxy, name: p.name, width: p.width, height: p.height });
  }
}
for (const f of [...files.keys()].filter((k) => /\.(wav|mp3|m4a)$/.test(k))) {
  items.push({ id: path.basename(f, path.extname(f)), kind: "audio", src: f, name: path.basename(f), label: `Generated soundtrack · ${plan.music?.bpm ?? 100} BPM`, bpm: plan.music?.bpm, duration: plan.music?.duration });
}
const manifest: MediaManifest = { version: 1, items };

const form = new FormData();
form.append("plan", JSON.stringify(plan));
form.append("meta", JSON.stringify({ pitch: meta.pitch ?? "Re-published by tests/web-republish.ts", source: meta.source }));
form.append("media", JSON.stringify(manifest));
form.append("video", new Blob([fs.readFileSync(path.join(dir, v.file))], { type: "video/mp4" }), "video.mp4");
form.append("poster", new Blob([fs.readFileSync(path.join(dir, v.poster))], { type: "image/jpeg" }), "poster.jpg");
for (const [name, local] of files) form.append("assets", new Blob([fs.readFileSync(local)]), name);

const res = await fetch(`${site}/api/videos`, { method: "POST", body: form, headers: env.PUBLISH_TOKEN ? { Authorization: `Bearer ${env.PUBLISH_TOKEN}` } : {} });
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);
console.log(`project: ${project ?? "(none)"} · ${files.size} files · ${items.length} media items`);
if (res.ok) {
  const { id, editKey } = JSON.parse(text);
  console.log(`edit link: ${site}/v/${id}/edit?key=${editKey}`);
}
