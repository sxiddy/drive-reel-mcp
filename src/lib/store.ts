import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EditPlan, isSafeAssetPath, planAssetPaths, type AspectRatio } from "@/shared/plan";

export const ROOT = process.cwd();
export const DATA = path.join(ROOT, "data", "videos");

export type Version = {
  n: number;
  file: string;
  poster: string;
  createdAt: string;
  durationSeconds: number;
  /** Frame shape of this render (missing on versions made before snapshots existed). */
  aspect?: AspectRatio;
  /** The exact plan this version was rendered from, e.g. "renders/v2.plan.json". */
  plan?: string;
};
export type RenderState = {
  status: "idle" | "queued" | "rendering" | "error";
  progress: number;
  /** One-line, human-readable reason a render failed. */
  error?: string;
  /** The renderer's stderr around the failure (stack trace), for a "Details" disclosure. */
  errorDetails?: string;
  startedAt?: string;
  queuedAt?: string;
  /** Version number being rendered (or waiting to render). */
  n?: number;
  /** Child process id while rendering, so a dead render can be detected right away. */
  pid?: number;
};
export type VideoMeta = {
  id: string;
  title: string;
  themeName: string;
  pitch?: string;
  /** Claude's story arc for the theme and why it suits the occasion. */
  story?: string;
  occasionFit?: string;
  occasion: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
  render: RenderState;
  /** Secret that unlocks editing. Never sent to browsers; see publicMeta(). */
  editKey?: string;
};
export type PublicMeta = Omit<VideoMeta, "editKey">;

export const isVideoId = (id: string) => /^[a-z0-9]{6,16}$/.test(id);

export const videoDir = (id: string) => {
  if (!isVideoId(id)) throw new Error("bad id");
  return path.join(DATA, id);
};

export function readMeta(id: string): VideoMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(videoDir(id), "meta.json"), "utf8")) as VideoMeta;
  } catch {
    return null;
  }
}

export function writeMeta(meta: VideoMeta) {
  const file = path.join(videoDir(meta.id), "meta.json");
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, file);
}

/** Read-modify-write of meta.json; returns the written meta (or null if the video is gone). */
export function updateMeta(id: string, fn: (m: VideoMeta) => VideoMeta | void): VideoMeta | null {
  const m = readMeta(id);
  if (!m) return null;
  const next = fn(m) ?? m;
  writeMeta(next);
  return next;
}

/** Everything about a video that is safe to send to a browser. */
export function publicMeta(meta: VideoMeta): PublicMeta {
  const { editKey: _secret, ...rest } = meta;
  void _secret;
  return rest;
}

export function readPlan(id: string): EditPlan {
  return EditPlan.parse(JSON.parse(fs.readFileSync(path.join(videoDir(id), "plan.json"), "utf8")));
}

export function writePlan(id: string, plan: EditPlan) {
  fs.writeFileSync(path.join(videoDir(id), "plan.json"), JSON.stringify({ ...plan, assetBase: "" }, null, 2));
}

/** The plan a version was rendered from, or null for legacy versions without a snapshot. */
export function readVersionPlan(id: string, v: Version): EditPlan | null {
  if (!v.plan) return null;
  try {
    return EditPlan.parse(JSON.parse(fs.readFileSync(safeJoin(videoDir(id), v.plan), "utf8")));
  } catch {
    return null;
  }
}

export function listVideos(): VideoMeta[] {
  if (!fs.existsSync(DATA)) return [];
  return fs
    .readdirSync(DATA)
    .filter(isVideoId)
    .map((id) => readMeta(id))
    .filter((m): m is VideoMeta => !!m && m.versions.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const newId = () => crypto.randomBytes(5).toString("hex");
export const newEditKey = () => crypto.randomBytes(16).toString("hex");

/** Keeps a relative upload path inside the video folder. */
export function safeJoin(base: string, rel: string) {
  const out = path.resolve(base, rel);
  if (!out.startsWith(path.resolve(base) + path.sep)) throw new Error(`unsafe path: ${rel}`);
  return out;
}

const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
const AUDIO_FILE = /\.(mp3|wav|m4a|aac|ogg)$/i;
const MEDIA_FILE = /\.(mp4|mov|webm|m4v|jpe?g|png|webp|mp3|wav|m4a|aac|ogg)$/i;

/**
 * Every asset the plan points at must be a plain relative path (no scheme, no "..") to a file that
 * exists inside the video's folder. This also stops the renderer's headless Chrome being pointed
 * at arbitrary URLs through music.src. Returns an error message, or null when the plan is fine.
 */
export function checkPlanAssets(dir: string, plan: Pick<EditPlan, "scenes" | "music">): string | null {
  // Each slot only takes its own kind of media file, so a plan can't point the renderer at meta.json & co.
  const want = new Map<string, RegExp>();
  for (const s of plan.scenes) {
    if (s.kind === "video") want.set(s.src, VIDEO_FILE);
    else if (s.kind === "image") want.set(s.src, IMAGE_FILE);
    else if (s.image) want.set(s.image, IMAGE_FILE);
  }
  if (plan.music) want.set(plan.music.src, AUDIO_FILE);
  for (const p of planAssetPaths(plan)) {
    if (!isSafeAssetPath(p)) return `asset path not allowed: ${p}`;
    if (!(want.get(p) ?? MEDIA_FILE).test(p)) return `not a media file of the right kind: ${p}`;
    let file: string;
    try {
      file = safeJoin(dir, p);
    } catch {
      return `asset path not allowed: ${p}`;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return `unknown asset ${p}`;
  }
  return null;
}

export const latest = (m: Pick<VideoMeta, "versions">) => m.versions[m.versions.length - 1];

// ---------------------------------------------------------------------------------------------
// Edit auth
// ---------------------------------------------------------------------------------------------

const siteUrl = () => (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * Returns the video's edit key, creating one for videos published before keys existed so they
 * aren't left open. A new key is printed to the server console so the owner can find it.
 */
export function ensureEditKey(id: string): string | null {
  const meta = readMeta(id);
  if (!meta) return null;
  if (meta.editKey) return meta.editKey;
  const key = newEditKey();
  updateMeta(id, (m) => {
    if (!m.editKey) m.editKey = key;
  });
  const saved = readMeta(id)?.editKey ?? key;
  console.log(`[drive-reel] Created an edit key for legacy video ${id}. Edit link: ${siteUrl()}/v/${id}/edit?key=${saved}`);
  return saved;
}

const sameSecret = (a: string, b: string) => {
  // Hash first so lengths always match and nothing leaks through timing.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
};

/** The site owner's publish token (only when one is configured; no token never grants edit rights). */
function hasPublishToken(req: Request) {
  const want = process.env.PUBLISH_TOKEN;
  if (!want) return false;
  return sameSecret(req.headers.get("authorization") ?? "", `Bearer ${want}`);
}

/** Allows a write to a video when the request carries its edit key (x-edit-key) or the publish token. */
export function canEditVideo(req: Request, id: string): boolean {
  if (hasPublishToken(req)) return true;
  const given = req.headers.get("x-edit-key");
  const want = ensureEditKey(id);
  if (!given || !want) return false;
  return sameSecret(given, want);
}

export function checkToken(req: Request) {
  const want = process.env.PUBLISH_TOKEN;
  if (!want) return true;
  return hasPublishToken(req);
}

// ---------------------------------------------------------------------------------------------
// Render queue: one render at a time across the whole site, FIFO.
// Lives on globalThis so Next's hot reload doesn't forget a running render or the queue.
// ---------------------------------------------------------------------------------------------

type QueueState = { queue: string[]; current: { id: string; pid: number } | null };
const G = globalThis as unknown as { __driveReelRenderQueue?: QueueState };
const Q: QueueState = (G.__driveReelRenderQueue ??= { queue: [], current: null });

export function pidAlive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How many renders must finish before this video's queued render starts. */
export function rendersAhead(id: string) {
  const i = Q.queue.indexOf(id);
  if (i < 0) return 0;
  return i + (Q.current ? 1 : 0);
}

/** Render state plus its queue position, for API responses. */
export const renderView = (meta: VideoMeta) => ({ ...meta.render, pid: undefined, ahead: meta.render.status === "queued" ? rendersAhead(meta.id) : 0 });

/**
 * Queues a re-render of the saved plan as a new version. The plan is snapshotted now
 * (renders/vN.plan.json) so edits saved while it waits or renders can't change what it renders.
 */
export function startRender(id: string): VideoMeta {
  const meta = readMeta(id);
  if (!meta) throw new Error("not found");
  if (meta.render.status === "rendering" || meta.render.status === "queued") {
    recoverStaleRender(meta);
    return readMeta(id)!;
  }
  const dir = videoDir(id);
  const n = (meta.versions.at(-1)?.n ?? 0) + 1;
  fs.mkdirSync(path.join(dir, "renders"), { recursive: true });
  fs.copyFileSync(path.join(dir, "plan.json"), path.join(dir, "renders", `v${n}.plan.json`));
  const now = new Date().toISOString();
  updateMeta(id, (m) => {
    m.render = { status: "queued", progress: 0, queuedAt: now, n };
  });
  if (!Q.queue.includes(id)) Q.queue.push(id);
  pump();
  return readMeta(id)!;
}

/** Starts the next queued render when nothing is rendering. */
function pump() {
  if (Q.current) {
    if (pidAlive(Q.current.pid)) return;
    // The child died without us hearing about it (e.g. hot reload swapped the close handler out).
    const dead = Q.current.id;
    Q.current = null;
    updateMeta(dead, (m) => {
      if (m.render.status === "rendering") m.render = { status: "error", progress: 0, error: "Render was interrupted. Try again." };
    });
  }
  while (Q.queue.length) {
    const id = Q.queue.shift()!;
    const meta = readMeta(id);
    if (!meta || meta.render.status !== "queued") continue;
    try {
      launch(meta);
      return;
    } catch (e) {
      updateMeta(id, (m) => {
        m.render = { status: "error", progress: 0, error: `Could not start the render: ${(e as Error).message}` };
      });
    }
  }
}

function launch(meta: VideoMeta) {
  const id = meta.id;
  const dir = videoDir(id);
  const n = meta.render.n ?? (meta.versions.at(-1)?.n ?? 0) + 1;
  const file = `renders/v${n}.mp4`;
  const poster = `renders/v${n}.jpg`;
  const snapshot = `renders/v${n}.plan.json`;
  if (!fs.existsSync(path.join(dir, snapshot))) fs.copyFileSync(path.join(dir, "plan.json"), path.join(dir, snapshot));

  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, "render/cli.ts", path.join(dir, snapshot), dir, path.join(dir, file), path.join(dir, poster)], {
    cwd: ROOT,
    windowsHide: true,
  });
  const pid = child.pid ?? 0;
  Q.current = { id, pid };
  updateMeta(id, (m) => {
    m.render = { status: "rendering", progress: 0, startedAt: new Date().toISOString(), n, pid };
  });

  let lastWrite = 0;
  let stderr = "";
  let stderrHead = "";
  let done: { durationInFrames: number } | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const p = line.match(/^PROGRESS ([\d.]+)/);
      if (p && Date.now() - lastWrite > 700) {
        lastWrite = Date.now();
        updateMeta(id, (m) => {
          if (m.render.status === "rendering") m.render = { ...m.render, progress: Number(p[1]) };
        });
      }
      const d = line.match(/^DONE (.+)$/);
      if (d) done = JSON.parse(d[1]);
    }
  });
  child.stderr.on("data", (d) => {
    // Keep the start (where the "Error: …" line usually is) and the tail (the stack).
    if (stderrHead.length < 16_000) stderrHead += d;
    stderr = (stderr + d).slice(-16_000);
  });
  const finish = (code: number | null) => {
    if (Q.current?.pid === pid) Q.current = null;
    updateMeta(id, (m) => {
      if (code === 0 && done) {
        // Metadata comes from the snapshot that was rendered, not from plan.json (which may have changed since).
        const plan = EditPlan.parse(JSON.parse(fs.readFileSync(path.join(dir, snapshot), "utf8")));
        m.versions.push({
          n,
          file,
          poster,
          createdAt: new Date().toISOString(),
          durationSeconds: Math.round((done.durationInFrames / plan.fps) * 10) / 10,
          aspect: plan.aspect,
          plan: snapshot,
        });
        m.title = plan.title;
        m.themeName = plan.themeName;
        m.updatedAt = new Date().toISOString();
        m.render = { status: "idle", progress: 1 };
      } else {
        m.render = { status: "error", progress: 0, ...describeRenderError(stderrHead, stderr, code) };
      }
    });
    pump();
  };
  let finished = false;
  child.on("close", (code) => {
    if (finished) return;
    finished = true;
    finish(code);
  });
  child.on("error", (e) => {
    if (finished) return;
    finished = true;
    stderr += `\n${e.message}`;
    finish(1);
  });
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Turns the renderer's stderr into a one-line message (the first "Error: …" line plus a line or two
 * of context that isn't a stack frame) and the tail as details.
 */
export function describeRenderError(head: string, tail: string, code: number | null): { error: string; errorDetails?: string } {
  const text = (head.length >= 16_000 ? `${head}\n…\n${tail}` : head).replace(ANSI, "");
  const lines = text.split(/\r?\n/);
  const frame = (l: string) => /^\s*at\s/.test(l) || /^\s*$/.test(l);
  const i = lines.findIndex((l) => /Error[:\s]/.test(l) && !frame(l));
  let message: string;
  if (i >= 0) {
    const extra = lines.slice(i + 1, i + 3).filter((l) => !frame(l) && l.trim().length < 200);
    message = [lines[i].trim(), ...extra.map((l) => l.trim())].join(" ");
  } else {
    message = lines.map((l) => l.trim()).find((l) => l && !frame(l)) ?? `The renderer exited with code ${code}.`;
  }
  message = message.replace(/^Uncaught\s+/, "").slice(0, 300);
  const details = tail.replace(ANSI, "").split(/\r?\n/).filter((l) => l.trim()).slice(-40).join("\n");
  return { error: message, ...(details ? { errorDetails: details } : {}) };
}

/**
 * Repairs render state left behind by a process that is gone: a render whose child died is marked
 * interrupted at once (its pid is checked), and a queued render this server doesn't know about
 * (the server restarted) is put back in the queue.
 */
export function recoverStaleRender(meta: VideoMeta): VideoMeta {
  const r = meta.render;
  if (r.status === "rendering") {
    const tracked = Q.current?.id === meta.id;
    const dead = r.pid ? !pidAlive(r.pid) : !!r.startedAt && Date.now() - Date.parse(r.startedAt) > 30 * 60_000;
    if (dead) {
      if (tracked) Q.current = null;
      const m = updateMeta(meta.id, (x) => {
        x.render = { status: "error", progress: 0, error: "Render was interrupted. Try again." };
      });
      pump();
      return m ?? meta;
    }
  } else if (r.status === "queued" && !Q.queue.includes(meta.id)) {
    Q.queue.push(meta.id);
    pump();
    return readMeta(meta.id) ?? meta;
  }
  return meta;
}
