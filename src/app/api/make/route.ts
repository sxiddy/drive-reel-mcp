import { isDriveLink, songPath } from "@/shared/make";
import { ROOT } from "@/src/lib/store";
import { MakeError, publicStatus, startMake } from "@/src/lib/make";

export const runtime = "nodejs";

/** Starts making a video from a Drive folder: { link, duration, occasion, auto? }. */
export async function POST(req: Request) {
  let body: { link?: unknown; duration?: unknown; occasion?: unknown; eventName?: unknown; place?: unknown; auto?: unknown; music?: unknown; songId?: unknown; matchSong?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const link = typeof body.link === "string" ? body.link.trim() : "";
  const occasion = typeof body.occasion === "string" ? body.occasion.trim() : "";
  const duration = Number(body.duration);
  // Optional on-screen names: short, single-line, no control characters.
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60) : "") || undefined;
  const eventName = clean(body.eventName);
  const place = clean(body.place);
  if (!isDriveLink(link)) return Response.json({ error: "Paste a Google Drive folder link (drive.google.com/…)." }, { status: 400 });
  if (occasion.length < 2 || occasion.length > 80) return Response.json({ error: "Say what the video is for, in 2–80 characters." }, { status: 400 });
  if (!Number.isFinite(duration) || duration < 8 || duration > 300) return Response.json({ error: "Pick a length between 8 seconds and 5 minutes." }, { status: 400 });
  const music = body.music === "own" ? "own" : "library";
  const songId = typeof body.songId === "string" && body.songId ? body.songId : undefined;
  if (songId && !songPath(ROOT, songId)) return Response.json({ error: "That song upload has expired. Upload it again." }, { status: 400 });
  try {
    const s = startMake({ source: link, occasion, duration: Math.round(duration), eventName, place, auto: body.auto === true, music, ...(music === "own" && songId ? { songId, matchSong: body.matchSong === true } : {}) });
    return Response.json(publicStatus(s), { status: 201 });
  } catch (e) {
    if (e instanceof MakeError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
