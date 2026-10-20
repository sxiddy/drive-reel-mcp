import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { contentType, parseRange } from "@/render/static-server";
import { isVideoId, safeJoin, videoDir } from "@/src/lib/store";

export const runtime = "nodejs";

/**
 * Only media files are public. meta.json (which holds the edit key), plans, temp files and anything
 * else are refused by the extension allowlist, whatever the casing or path tricks.
 */
const SERVABLE = new Set([".mp4", ".mov", ".webm", ".m4v", ".jpg", ".jpeg", ".png", ".webp", ".wav", ".mp3", ".m4a", ".aac", ".ogg"]);
const EXTRA_TYPES: Record<string, string> = { ".aac": "audio/aac", ".ogg": "audio/ogg", ".m4v": "video/mp4" };

/**
 * One path segment: no dotfiles, no "..", no backslashes, colons (NTFS streams) or trailing
 * dots/spaces (which Windows strips, so "meta.json." would open meta.json).
 */
const SEGMENT = /^[A-Za-z0-9_][\w\-. ]*$/;
const segmentOk = (s: string) => SEGMENT.test(s) && !/[. ]$/.test(s) && !s.includes("..");

/** Serves a video's files with HTTP range support (needed for seeking in <video> and the editor's player). */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const [id, ...rest] = (await ctx.params).path;
  if (!id || !isVideoId(id) || rest.length === 0 || !rest.every(segmentOk)) return new Response("not found", { status: 404 });
  const ext = path.extname(rest[rest.length - 1]).toLowerCase();
  if (!SERVABLE.has(ext)) return new Response("not found", { status: 404 });
  let file: string;
  try {
    file = safeJoin(videoDir(id), rest.join("/"));
  } catch {
    return new Response("not found", { status: 404 });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("not found", { status: 404 });
  const size = stat.size;
  const headers: Record<string, string> = {
    "Content-Type": EXTRA_TYPES[ext] ?? contentType(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range) {
    const stream = Readable.toWeb(fs.createReadStream(file, range)) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) } });
  }
  const download = new URL(req.url).searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.-]/g, "_")}"`;
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
