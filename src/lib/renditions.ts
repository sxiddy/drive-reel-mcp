import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIMENSIONS, type AspectRatio } from "@/shared/plan";
import { ROOT, safeJoin, videoDir, type Version } from "./store";

/**
 * Files derived from a version on demand with ffmpeg (the ffmpeg-static binary the renderer uses):
 * a 720p download and a 1200x630 link-preview image. Both are cached next to the version in renders/
 * under names the media route allows, written to a dotfile first (which the media route refuses) and
 * renamed into place when complete, so a half-written file is never served.
 */

const FFMPEG = path.join(ROOT, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

/** The 1080p render, a 720p downscale, or the 4K re-render. */
export type Quality = "720p" | "1080p" | "4k";

/** Pixel size of a version's own file. */
export function versionSize(v: Version, fallback: AspectRatio = "16:9") {
  if (v.width && v.height) return { width: v.width, height: v.height };
  return DIMENSIONS[v.aspect ?? fallback];
}

/** Short side 720, long side scaled to match (and kept even for H.264). */
export function size720(v: Version) {
  const { width, height } = versionSize(v);
  const k = 720 / Math.min(width, height);
  const even = (x: number) => Math.round((x * k) / 2) * 2;
  return { width: even(width), height: even(height) };
}

/** "Into the Wild" + v2 + 9:16 + 720p -> "into-the-wild-v2-9x16-720p.mp4" */
export function downloadName(title: string, n: number, aspect: string | undefined, quality: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";
  return `${slug}-v${n}${aspect ? `-${aspect.replace(":", "x")}` : ""}-${quality}.mp4`;
}

export const file720 = (v: Version) => `renders/v${v.n}-720p.mp4`;
export const fileOg = (v: Version) => `renders/v${v.n}-og.jpg`;

const exists = (f: string) => {
  try {
    return fs.statSync(f).isFile() && fs.statSync(f).size > 0;
  } catch {
    return false;
  }
};

export function fileBytes(id: string, rel: string): number | null {
  try {
    return fs.statSync(safeJoin(videoDir(id), rel)).size;
  } catch {
    return null;
  }
}

function run(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-nostats", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    let err = "";
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${err.trim().slice(-500)}`));
    });
  });
}

// One ffmpeg job per output file, and at most two at once across the site (they are CPU heavy).
type Derived = { inFlight: Map<string, Promise<void>>; running: number; waiters: (() => void)[] };
const G = globalThis as unknown as { __driveReelDerived?: Derived };
const D: Derived = (G.__driveReelDerived ??= { inFlight: new Map(), running: 0, waiters: [] });
const MAX_RUNNING = 2;

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (D.running >= MAX_RUNNING) await new Promise<void>((r) => D.waiters.push(r));
  D.running++;
  try {
    return await fn();
  } finally {
    D.running--;
    D.waiters.shift()?.();
  }
}

/** Makes `out` with ffmpeg (writing `.<name>.part` then renaming), once, however many callers ask at the same time. */
function derive(out: string, make: (tmp: string) => string[], timeoutMs: number): Promise<void> {
  if (exists(out)) return Promise.resolve();
  const pending = D.inFlight.get(out);
  if (pending) return pending;
  const job = slot(async () => {
    if (exists(out)) return;
    const tmp = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.part`);
    try {
      await run(make(tmp), timeoutMs);
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }).finally(() => D.inFlight.delete(out));
  D.inFlight.set(out, job);
  return job;
}

/** The 720p download of a version (H.264/AAC, fast start), made on first request and cached. Returns its relative path. */
export async function ensure720(id: string, v: Version): Promise<string> {
  const dir = videoDir(id);
  const src = safeJoin(dir, v.file);
  if (!exists(src)) throw new Error("the render is missing");
  const rel = file720(v);
  const { width, height } = size720(v);
  await derive(
    safeJoin(dir, rel),
    (tmp) => [
      "-i", src,
      "-map", "0:v:0", "-map", "0:a?",
      "-vf", `scale=${width}:${height}:flags=lanczos`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-f", "mp4", tmp,
    ],
    5 * 60_000,
  );
  return rel;
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * A 1200x630 link-preview image from the version's poster: landscape posters are cropped to fill;
 * portrait and square ones sit centred over a blurred, darkened copy of themselves (like the Reel's
 * own fill for mismatched clips), so a 9:16 reel still makes a proper wide preview card.
 */
export async function ensureOgImage(id: string, v: Version): Promise<string> {
  const dir = videoDir(id);
  const src = safeJoin(dir, v.poster);
  if (!exists(src)) throw new Error("the poster is missing");
  const rel = fileOg(v);
  const { width: W, height: H } = OG_SIZE;
  const { width, height } = versionSize(v);
  const wide = width / height > 1.5;
  const filter = wide
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`
    : `[0:v]split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.18:saturation=1.1[bg];` +
      `[b]scale=-2:${H - 56}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  await derive(safeJoin(dir, rel), (tmp) => ["-i", src, wide ? "-vf" : "-filter_complex", filter, "-frames:v", "1", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", tmp], 30_000);
  return rel;
}
