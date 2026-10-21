import fs from "node:fs";
import path from "node:path";
import { isMakeId, readStatus } from "@/shared/make";
import { PROJECTS, sweepFootage } from "./make";
import { DATA, isVideoId, listVideos, videoDir } from "./store";

/**
 * Keeps the laptop's disk from filling up. A published video is deleted 14 days after anyone last
 * watched it, and 30 days after it was made whatever happens; its website job goes with it.
 */
const UNWATCHED_MS = 14 * 86400_000;
const MAX_AGE_MS = 30 * 86400_000;
const VIEWED = ".viewed";

/** Records that someone watched a video (at most once a minute; the file's mtime is the time). */
export function markViewed(id: string) {
  if (!isVideoId(id)) return;
  const f = path.join(videoDir(id), VIEWED);
  try {
    const st = fs.statSync(f, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs < 60_000) return;
    fs.writeFileSync(f, "");
  } catch {}
}

/** Deletes expired videos and their jobs; `dry` only reports what would go. */
export function expireVideos(now = Date.now(), dry = false) {
  const gone = new Set<string>();
  for (const m of listVideos()) {
    const made = Date.parse(m.createdAt) || now;
    const seen = fs.statSync(path.join(videoDir(m.id), VIEWED), { throwIfNoEntry: false })?.mtimeMs ?? made;
    const last = Math.max(made, seen);
    if (now - made > MAX_AGE_MS || now - last > UNWATCHED_MS) {
      if (!dry) fs.rmSync(videoDir(m.id), { recursive: true, force: true });
      gone.add(m.id);
    }
  }
  // Website jobs whose video is gone, or that never got one and are past the limit.
  if (fs.existsSync(PROJECTS)) {
    for (const id of fs.readdirSync(PROJECTS)) {
      if (!isMakeId(id)) continue;
      const dir = path.join(PROJECTS, id);
      const s = readStatus(dir);
      const vid = s?.result?.videoId;
      const old = now - (Date.parse(s?.createdAt ?? "") || now) > MAX_AGE_MS;
      if ((vid && (gone.has(vid) || !fs.existsSync(path.join(DATA, vid)))) || (!vid && old)) {
        if (dry) gone.add(`job:${id}`);
        else fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return [...gone];
}

function sweepAll() {
  try {
    sweepFootage();
    expireVideos();
  } catch (e) {
    console.error("storage sweep failed", e);
  }
}

// Runs once when the server starts serving pages, then every 10 minutes.
const g = globalThis as { __retention?: NodeJS.Timeout };
if (!g.__retention) {
  g.__retention = setInterval(sweepAll, 10 * 60_000);
  g.__retention.unref();
  setTimeout(sweepAll, 5_000).unref();
}
