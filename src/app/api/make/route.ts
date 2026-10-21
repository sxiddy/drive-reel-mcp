import { isDriveLink } from "@/shared/make";
import { MakeError, publicStatus, startMake } from "@/src/lib/make";

export const runtime = "nodejs";

/** Starts making a video from a Drive folder: { link, duration, occasion, auto? }. */
export async function POST(req: Request) {
  let body: { link?: unknown; duration?: unknown; occasion?: unknown; auto?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const link = typeof body.link === "string" ? body.link.trim() : "";
  const occasion = typeof body.occasion === "string" ? body.occasion.trim() : "";
  const duration = Number(body.duration);
  if (!isDriveLink(link)) return Response.json({ error: "Paste a Google Drive folder link (drive.google.com/…)." }, { status: 400 });
  if (occasion.length < 2 || occasion.length > 80) return Response.json({ error: "Say what the video is for, in 2–80 characters." }, { status: 400 });
  if (!Number.isFinite(duration) || duration < 8 || duration > 300) return Response.json({ error: "Pick a length between 8 seconds and 5 minutes." }, { status: 400 });
  try {
    const s = startMake({ source: link, occasion, duration: Math.round(duration), auto: body.auto === true });
    return Response.json(publicStatus(s), { status: 201 });
  } catch (e) {
    if (e instanceof MakeError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
