import { z } from "zod";
import { downloadName, ensure720, fileBytes, size720, versionSize } from "@/src/lib/renditions";
import { isVideoId, readMeta } from "@/src/lib/store";

export const runtime = "nodejs";

const Body = z.strictObject({ v: z.number().int().min(1).max(9999), quality: z.enum(["720p", "1080p", "4k"]) });

/**
 * Gets a version ready to download at a quality and answers with its URL. 720p is an ffmpeg downscale
 * made on first request and cached next to the render (one job per file, so repeated clicks are cheap);
 * if it takes longer than ~40s the answer is 202 and the browser asks again. 1080p is the render itself and
 * 4K the 4K re-render when one exists (making one needs the edit key; see the render route).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  if (!meta) return new Response("not found", { status: 404 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("expected a JSON body", { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return new Response("Bad download request", { status: 400 });
  const { v: n, quality } = parsed.data;
  const v = meta.versions.find((x) => x.n === n);
  if (!v) return new Response("There is no such version.", { status: 404 });
  const name = downloadName(meta.title, v.n, v.aspect, quality);
  const answer = (file: string, size: { width: number; height: number }) =>
    Response.json({ status: "ready", url: `/media/${id}/${file}?download=${encodeURIComponent(name)}`, ...size, bytes: fileBytes(id, file) }, { headers: { "Cache-Control": "no-store" } });

  if (quality === "1080p") return answer(v.file, versionSize(v));
  if (quality === "4k") {
    if (!v.uhd || fileBytes(id, v.uhd.file) === null) return new Response("This version has no 4K render yet.", { status: 404 });
    return answer(v.uhd.file, { width: v.uhd.width, height: v.uhd.height });
  }
  const job = ensure720(id, v);
  const timeout = new Promise<"wait">((r) => setTimeout(() => r("wait"), 40_000));
  try {
    const out = await Promise.race([job, timeout]);
    if (out === "wait") {
      job.catch(() => undefined);
      return Response.json({ status: "preparing" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return answer(out, size720(v));
  } catch (e) {
    console.error(`[drive-reel] 720p for ${id} v${n} failed:`, e);
    return new Response("Couldn't prepare the 720p file. Try again.", { status: 500 });
  }
}
