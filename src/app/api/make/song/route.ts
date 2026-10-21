import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_SONG_BYTES, sniffAudio } from "@/shared/make";
import { ROOT } from "@/src/lib/store";

export const runtime = "nodejs";

/** Length and tempo of a saved song, measured by pipeline/song-info.ts (ffprobe + beat detection) in its own process. */
function songInfo(file: string): Promise<{ audio: boolean; duration?: number; bpm?: number }> {
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  return new Promise((resolve) => {
    execFile(process.execPath, [tsx, "pipeline/song-info.ts", file], { cwd: ROOT, windowsHide: true, timeout: 90_000 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop() ?? ""));
      } catch {
        resolve({ audio: !err });
      }
    });
  });
}

/**
 * Saves a song uploaded on the form (raw body, ≤ 40 MB, MP3/WAV/M4A/AAC/OGG by its magic bytes, and
 * ffprobe must find an audio stream) under work/uploads/<24 hex>.<ext>. Returns {songId, duration, bpm}.
 */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SONG_BYTES) return Response.json({ error: "Songs can be up to 40 MB." }, { status: 413 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > MAX_SONG_BYTES) return Response.json({ error: "Songs can be up to 40 MB." }, { status: 413 });
  const ext = sniffAudio(buf.subarray(0, 64));
  if (!ext) return Response.json({ error: "That isn't an MP3, WAV, M4A, AAC or OGG file." }, { status: 400 });
  const songId = crypto.randomBytes(12).toString("hex");
  const dir = path.join(ROOT, "work", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${songId}.${ext}`);
  fs.writeFileSync(file, buf);
  const info = await songInfo(file);
  if (!info.audio) {
    fs.rmSync(file, { force: true });
    return Response.json({ error: "That file has no playable audio (or is under 5 seconds)." }, { status: 400 });
  }
  return Response.json({ songId, duration: info.duration, bpm: info.bpm }, { status: 201 });
}
