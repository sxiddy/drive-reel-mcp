import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isSafeAssetPath, type EditPlan } from "@/shared/plan";
import type { MediaItem, MediaManifest } from "@/shared/media";
import { ROOT, safeJoin, videoDir } from "./store";

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

export function kindOf(src: string): MediaItem["kind"] | null {
  const ext = path.extname(src).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

const exists = (dir: string, rel: string | undefined) => {
  if (!rel || !isSafeAssetPath(rel)) return false;
  try {
    return fs.statSync(safeJoin(dir, rel)).isFile();
  } catch {
    return false;
  }
};

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const str = (x: unknown, max = 200) => (typeof x === "string" ? x.slice(0, max) : undefined);

/**
 * Validates an untrusted media manifest (from the publisher or disk): every item must point at a
 * file that exists in the video's folder; anything else is dropped, and unknown fields are removed.
 */
export function sanitizeManifest(dir: string, raw: unknown): MediaManifest {
  const items: MediaItem[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as MediaManifest).items) ? (raw as MediaManifest).items : [];
  const seen = new Set<string>();
  for (const it of list.slice(0, 500)) {
    if (!it || typeof it !== "object") continue;
    const src = str(it.src, 300);
    const kind = it.kind;
    if (!src || !exists(dir, src) || (kind !== "video" && kind !== "image" && kind !== "audio") || seen.has(src)) continue;
    seen.add(src);
    const item: MediaItem = { id: str(it.id, 40) || src, kind, src, name: str(it.name) || path.basename(src) };
    const d = num(it.duration);
    if (d) item.duration = d;
    if (num(it.width)) item.width = it.width;
    if (num(it.height)) item.height = it.height;
    if (kind === "video" && exists(dir, it.sheet) && Array.isArray(it.sheetTimes)) {
      item.sheet = it.sheet;
      item.sheetTimes = it.sheetTimes.filter((t) => num(t) !== undefined).slice(0, 8);
    }
    if (Array.isArray(it.highlights)) {
      const hl = it.highlights.map((h) => (typeof h === "number" ? h : (h as { start?: number })?.start)).filter((t): t is number => num(t) !== undefined);
      if (hl.length) item.highlights = hl.slice(0, 20);
    }
    if (str(it.label)) item.label = str(it.label, 120);
    if (num(it.bpm)) item.bpm = it.bpm;
    items.push(item);
  }
  return { version: 1, items };
}

/** Items for assets the plan uses but the manifest doesn't list (all of them for legacy videos). */
function itemsFromPlan(dir: string, plan: EditPlan, have: Set<string>): MediaItem[] {
  const out: MediaItem[] = [];
  const add = (item: MediaItem) => {
    if (have.has(item.src) || !exists(dir, item.src)) return;
    have.add(item.src);
    out.push(item);
  };
  const idOf = (src: string) => path.basename(src, path.extname(src));
  for (const s of plan.scenes) {
    if (s.kind === "video") {
      add({ id: idOf(s.src), kind: "video", src: s.src, name: path.basename(s.src), duration: s.sourceDuration, width: s.srcWidth, height: s.srcHeight });
    } else if (s.kind === "image") {
      add({ id: idOf(s.src), kind: "image", src: s.src, name: path.basename(s.src) });
    } else if (s.image) {
      add({ id: idOf(s.image), kind: "image", src: s.image, name: path.basename(s.image) });
    }
  }
  if (plan.music) {
    add({ id: idOf(plan.music.src), kind: "audio", src: plan.music.src, name: path.basename(plan.music.src), label: plan.music.credit ?? "Soundtrack", bpm: plan.music.bpm, duration: plan.music.duration });
  }
  // Legacy videos: a contact sheet uploaded next to a clip (sheets/v3.jpg for assets/v3.mp4) still helps the timeline.
  for (const it of out) {
    if (it.kind !== "video" || !it.duration) continue;
    const sheet = `sheets/${it.id}.jpg`;
    if (exists(dir, sheet)) {
      it.sheet = sheet;
      it.sheetTimes = Array.from({ length: 8 }, (_, k) => Math.round(((k * it.duration!) / 8) * 100) / 100);
    }
  }
  return out;
}

/** media.json if present (validated), topped up with anything the current plan uses that it doesn't list. */
export function loadMedia(id: string, plan: EditPlan): MediaManifest {
  const dir = videoDir(id);
  let manifest: MediaManifest = { version: 1, items: [] };
  try {
    manifest = sanitizeManifest(dir, JSON.parse(fs.readFileSync(path.join(dir, "media.json"), "utf8")));
  } catch {
    /* legacy video: derive everything from the plan */
  }
  const have = new Set(manifest.items.map((i) => i.src));
  return { version: 1, items: [...manifest.items, ...itemsFromPlan(dir, plan, have)] };
}

export function writeMedia(id: string, manifest: MediaManifest) {
  const file = path.join(videoDir(id), "media.json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(manifest, null, 2));
  fs.renameSync(file + ".tmp", file);
}

// ---------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------

export const UPLOAD_RULES = {
  audio: { exts: ["mp3", "wav", "m4a", "aac", "ogg"], maxBytes: 40 * 1024 * 1024 },
  image: { exts: ["jpg", "jpeg", "png", "webp"], maxBytes: 20 * 1024 * 1024 },
} as const;

const ascii = (b: Buffer, start: number, len: number) => b.subarray(start, start + len).toString("latin1");

/** Checks the file's first bytes really are the format its extension claims. */
export function magicMatches(ext: string, b: Buffer): boolean {
  if (b.length < 12) return false;
  switch (ext) {
    case "jpg":
    case "jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "png":
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "webp":
      return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP";
    case "wav":
      return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE";
    case "mp3":
      return ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0);
    case "aac":
      return ascii(b, 0, 4) === "ADIF" || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) || ascii(b, 0, 3) === "ID3";
    case "m4a":
      return ascii(b, 4, 4) === "ftyp";
    case "ogg":
      return ascii(b, 0, 4) === "OggS";
    default:
      return false;
  }
}

/** Next free "assets/u<n>.<ext>" name in the video's folder. */
export function nextUploadName(dir: string, ext: string) {
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  const used = fs
    .readdirSync(path.join(dir, "assets"))
    .map((f) => f.match(/^u(\d+)\./)?.[1])
    .filter(Boolean)
    .map(Number);
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return { id: `u${n}`, rel: `assets/u${n}.${ext}` };
}

const FFPROBE = path.join(ROOT, "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

/** Duration and frame size via ffprobe (the same binary the MCP server uses); empty when unavailable. */
export function probe(file: string): Promise<{ duration?: number; width?: number; height?: number }> {
  if (!fs.existsSync(FFPROBE)) return Promise.resolve({});
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ["-v", "error", "-print_format", "json", "-show_entries", "format=duration:stream=width,height,codec_type", file], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => p.kill(), 15_000);
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve({}));
    p.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { width?: number; height?: number; codec_type?: string }[] };
        const v = j.streams?.find((s) => s.width && s.height);
        const d = Number(j.format?.duration);
        resolve({ duration: Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : undefined, width: v?.width, height: v?.height });
      } catch {
        resolve({});
      }
    });
  });
}
