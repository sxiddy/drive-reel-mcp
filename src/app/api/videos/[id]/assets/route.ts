import fs from "node:fs";
import path from "node:path";
import type { MediaItem } from "@/shared/media";
import { loadMedia, magicMatches, nextUploadName, probe, UPLOAD_RULES, writeMedia } from "@/src/lib/media";
import { canEditVideo, isVideoId, readMeta, readPlan, videoDir } from "@/src/lib/store";

export const runtime = "nodejs";

/** The video's media bin: media.json, or items derived from the plan for legacy videos. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  return Response.json(loadMedia(id, readPlan(id)));
}

/**
 * Uploads a song (mp3/wav/m4a/aac/ogg, ≤ 40 MB) or photo (jpg/png/webp, ≤ 20 MB) into the media bin.
 * Multipart field "file". The server picks the stored name (assets/u<n>.<ext>) and checks the
 * extension against the file's magic bytes. Responds with the new MediaItem. Needs the edit key.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoId(id) || !readMeta(id)) return new Response("not found", { status: 404 });
  if (!canEditVideo(req, id)) return new Response("This video can only be changed with its edit link.", { status: 401 });
  const max = Math.max(UPLOAD_RULES.audio.maxBytes, UPLOAD_RULES.image.maxBytes);
  if (Number(req.headers.get("content-length") ?? 0) > max + 1024 * 1024) return new Response("File is too large.", { status: 413 });

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return new Response("expected multipart form data with a file", { status: 400 });
  }
  if (!(file instanceof File)) return new Response("expected a file", { status: 400 });

  const ext = path.extname(file.name).slice(1).toLowerCase();
  const kind = (UPLOAD_RULES.audio.exts as readonly string[]).includes(ext) ? "audio" : (UPLOAD_RULES.image.exts as readonly string[]).includes(ext) ? "image" : null;
  if (!kind) return new Response("Songs must be mp3, wav, m4a, aac or ogg; photos jpg, png or webp.", { status: 415 });
  const rule = UPLOAD_RULES[kind];
  if (file.size > rule.maxBytes) return new Response(`${kind === "audio" ? "Songs" : "Photos"} can be at most ${rule.maxBytes / 1024 / 1024} MB.`, { status: 413 });
  if (file.size === 0) return new Response("The file is empty.", { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!magicMatches(ext, buf)) return new Response(`That file isn't a valid .${ext}.`, { status: 415 });

  const dir = videoDir(id);
  const storedExt = ext === "jpeg" ? "jpg" : ext;
  const { id: itemId, rel } = nextUploadName(dir, storedExt);
  const dest = path.join(dir, rel);
  fs.writeFileSync(dest, buf, { flag: "wx" });

  // Duration (songs) and size (photos); missing if ffprobe can't read it, which the editor tolerates.
  const info = await probe(dest);
  const name = path.basename(file.name).replace(/[^\w .()\-]/g, "_").slice(0, 120) || `${itemId}.${storedExt}`;
  const item: MediaItem = {
    id: itemId,
    kind,
    src: rel,
    name,
    label: kind === "audio" ? "Uploaded song" : "Uploaded photo",
    ...(info.duration && kind === "audio" ? { duration: info.duration } : {}),
    ...(info.width && info.height ? { width: info.width, height: info.height } : {}),
  };
  const manifest = loadMedia(id, readPlan(id));
  manifest.items.push(item);
  writeMedia(id, manifest);
  return Response.json(item);
}
