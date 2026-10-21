import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DIMENSIONS, EditPlan, isSafeAssetPath, planAssetPaths, type AspectRatio } from "@/shared/plan";

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
  /** Pixel size of `file` (missing on versions made before it was recorded; DIMENSIONS[aspect] then). */
  width?: number;
  height?: number;
  /** When this version is another format of an earlier version's edit (exported from the watch page). */
  from?: number;
  /** A 4K re-render of this exact version (Remotion scale 2), made on request. */
  uhd?: Rendition;
};
/** An extra file made from a version: same edit, different resolution. */
export type Rendition = { file: string; width: number; height: number; createdAt: string; scale: number };

/** One render waiting or running. A video can have several (e.g. 16:9, 9:16 and a 4K), done one at a time. */
export type RenderJob = {
  /** "v4" for a new version, "v2-4k" for a 4K re-render of version 2. */
  key: string;
  kind: "version" | "uhd";
  /** Version produced (kind "version") or re-rendered (kind "uhd"). */
  n: number;
  aspect: AspectRatio;
  scale: number;
  status: "queued" | "rendering";
  progress: number;
  queuedAt: string;
  startedAt?: string;
  pid?: number;
  /** Version whose edit this new format was made from (kind "version" from the watch page). */
  from?: number;
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
  /** Summary of the render jobs below (what the editor's Export button shows). */
  render: RenderState;
  /** Renders waiting or running for this video, oldest first. */
  jobs?: RenderJob[];
  /** Why the last render failed; cleared when new renders are queued. */
  renderError?: { key: string; error: string; errorDetails?: string; at: string };
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
  return { ...rest, render: { ...rest.render, pid: undefined }, jobs: rest.jobs?.map((j) => ({ ...j, pid: undefined })) };
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
// Render queue: one render at a time across the whole site, FIFO. A video can have several jobs
// waiting (say a 9:16 and a 1:1 export plus a 4K), each snapshotted when it was queued.
// Lives on globalThis so Next's hot reload doesn't forget a running render or the queue.
// ---------------------------------------------------------------------------------------------

type QueueEntry = { id: string; key: string };
type QueueState = { queue: QueueEntry[]; current: (QueueEntry & { pid: number }) | null };
const G = globalThis as unknown as { __driveReelRenderJobs?: QueueState };
const Q: QueueState = (G.__driveReelRenderJobs ??= { queue: [], current: null });

/** At most this many renders waiting or running per video. */
export const MAX_JOBS_PER_VIDEO = 6;

/** A request the queue refuses, with the HTTP status the route should answer with. */
export class RenderRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

const sameEntry = (a: QueueEntry, b: QueueEntry) => a.id === b.id && a.key === b.key;

/** How many renders must finish before this job starts (0 when it is running or unknown). */
export function jobsAhead(id: string, key: string) {
  const i = Q.queue.findIndex((e) => sameEntry(e, { id, key }));
  if (i < 0) return 0;
  return i + (Q.current ? 1 : 0);
}

/** How many renders must finish before this video's next queued render starts. */
export function rendersAhead(id: string) {
  const i = Q.queue.findIndex((e) => e.id === id);
  if (i < 0) return 0;
  return i + (Q.current ? 1 : 0);
}

/** A job as the browser sees it. */
export type JobView = Omit<RenderJob, "pid"> & { ahead: number };
export const jobView = (id: string, j: RenderJob): JobView => {
  const { pid: _pid, ...rest } = j;
  void _pid;
  return { ...rest, ahead: j.status === "queued" ? jobsAhead(id, j.key) : 0 };
};

/** Render state plus its queue position and the job list, for API responses. */
export const renderView = (meta: VideoMeta) => ({
  ...meta.render,
  pid: undefined,
  ahead: meta.render.status === "queued" ? rendersAhead(meta.id) : 0,
  jobs: (meta.jobs ?? []).map((j) => jobView(meta.id, j)),
});

/** Recomputes meta.render (the one-line summary the editor shows) from the job list and the last error. */
function summarize(m: VideoMeta) {
  const jobs = m.jobs ?? [];
  const running = jobs.find((j) => j.status === "rendering");
  const waiting = jobs.filter((j) => j.status === "queued");
  const err = m.renderError ? { error: m.renderError.error, ...(m.renderError.errorDetails ? { errorDetails: m.renderError.errorDetails } : {}) } : {};
  if (running) m.render = { status: "rendering", progress: running.progress, startedAt: running.startedAt, n: running.n, ...err };
  else if (waiting.length) m.render = { status: "queued", progress: 0, queuedAt: waiting[0].queuedAt, n: waiting[0].n, ...err };
  else if (m.renderError) m.render = { status: "error", progress: 0, ...err };
  else m.render = { status: "idle", progress: 1 };
  if (!jobs.length) delete m.jobs;
}

const snapshotText = (plan: EditPlan) => JSON.stringify({ ...plan, assetBase: "" }, null, 2);
const nextVersionNumber = (m: VideoMeta) =>
  Math.max(0, ...m.versions.map((v) => v.n), ...(m.jobs ?? []).filter((j) => j.kind === "version").map((j) => j.n)) + 1;

function enqueue(id: string, job: RenderJob) {
  updateMeta(id, (m) => {
    m.jobs = [...(m.jobs ?? []), job];
    delete m.renderError;
    summarize(m);
  });
  if (!Q.queue.some((e) => sameEntry(e, { id, key: job.key }))) Q.queue.push({ id, key: job.key });
  pump();
}

export type RenderRequest = {
  /** Frame shape to export; defaults to the plan's own. */
  aspect?: AspectRatio;
  /** Export this version's edit (its plan snapshot) instead of the saved plan. */
  from?: number;
};

/**
 * Queues a new version. The plan (the saved plan, or version `from`'s snapshot) is snapshotted now as
 * renders/vN.plan.json with `aspect` overridden, so plan.json is untouched and edits saved while it
 * waits can't change what it renders. Asking again for a render that is already waiting is a no-op.
 */
export function startRender(id: string, req: RenderRequest = {}): VideoMeta {
  const raw = readMeta(id);
  if (!raw) throw new RenderRequestError("not found", 404);
  const meta = recoverStaleRender(raw);
  const dir = videoDir(id);
  let base: EditPlan;
  if (req.from !== undefined) {
    const v = meta.versions.find((x) => x.n === req.from);
    if (!v) throw new RenderRequestError(`There is no version ${req.from}.`, 404);
    const p = readVersionPlan(id, v);
    if (!p) throw new RenderRequestError(`Version ${req.from} was made before plan snapshots existed, so it can't be re-exported. Export from the editor instead.`, 409);
    base = p;
  } else {
    base = readPlan(id);
  }
  const plan: EditPlan = { ...base, aspect: req.aspect ?? base.aspect };
  const text = snapshotText(plan);
  const jobs = meta.jobs ?? [];
  // The same render already waiting or running (a double click, or a second tab): nothing to add.
  for (const j of jobs) {
    if (j.kind !== "version") continue;
    try {
      if (fs.readFileSync(path.join(dir, "renders", `v${j.n}.plan.json`), "utf8") === text) return readMeta(id)!;
    } catch {
      /* snapshot gone: not a duplicate */
    }
  }
  if (jobs.length >= MAX_JOBS_PER_VIDEO) throw new RenderRequestError(`${jobs.length} renders are already waiting for this video. Let some finish first.`, 429);
  const n = nextVersionNumber(meta);
  fs.mkdirSync(path.join(dir, "renders"), { recursive: true });
  fs.writeFileSync(path.join(dir, "renders", `v${n}.plan.json`), text);
  enqueue(id, {
    key: `v${n}`,
    kind: "version",
    n,
    aspect: plan.aspect,
    scale: 1,
    status: "queued",
    progress: 0,
    queuedAt: new Date().toISOString(),
    ...(req.from !== undefined ? { from: req.from } : {}),
  });
  return readMeta(id)!;
}

/** Queues a 4K (scale 2) re-render of version n from its plan snapshot. A no-op when it exists or is waiting. */
export function startUhdRender(id: string, n: number): VideoMeta {
  const raw = readMeta(id);
  if (!raw) throw new RenderRequestError("not found", 404);
  const meta = recoverStaleRender(raw);
  const v = meta.versions.find((x) => x.n === n);
  if (!v) throw new RenderRequestError(`There is no version ${n}.`, 404);
  const key = `v${n}-4k`;
  if (meta.jobs?.some((j) => j.key === key)) return meta;
  if (v.uhd && fs.existsSync(safeJoin(videoDir(id), v.uhd.file))) return meta;
  const plan = readVersionPlan(id, v);
  if (!plan) throw new RenderRequestError(`Version ${n} was made before plan snapshots existed, so it can't be re-rendered in 4K.`, 409);
  if ((meta.jobs?.length ?? 0) >= MAX_JOBS_PER_VIDEO) throw new RenderRequestError("Too many renders are already waiting for this video. Let some finish first.", 429);
  enqueue(id, { key, kind: "uhd", n, aspect: v.aspect ?? plan.aspect, scale: 2, status: "queued", progress: 0, queuedAt: new Date().toISOString() });
  return readMeta(id)!;
}

/** Starts the next queued render when nothing is rendering. */
function pump() {
  if (Q.current) {
    if (pidAlive(Q.current.pid)) return;
    // The child died without us hearing about it (e.g. hot reload swapped the close handler out).
    const dead = Q.current;
    Q.current = null;
    updateMeta(dead.id, (m) => {
      const j = m.jobs?.find((x) => x.key === dead.key);
      if (j?.status === "rendering") {
        m.jobs = m.jobs!.filter((x) => x !== j);
        m.renderError = { key: j.key, error: "Render was interrupted. Try again.", at: new Date().toISOString() };
        summarize(m);
      }
    });
  }
  while (Q.queue.length) {
    const entry = Q.queue.shift()!;
    const meta = readMeta(entry.id);
    const job = meta?.jobs?.find((j) => j.key === entry.key);
    if (!meta || !job || job.status !== "queued") continue;
    try {
      launch(meta, job);
      return;
    } catch (e) {
      updateMeta(entry.id, (m) => {
        m.jobs = (m.jobs ?? []).filter((j) => j.key !== entry.key);
        m.renderError = { key: entry.key, error: `Could not start the render: ${(e as Error).message}`, at: new Date().toISOString() };
        summarize(m);
      });
    }
  }
}

/** Where a job's plan comes from and where its output goes. */
function jobFiles(meta: VideoMeta, job: RenderJob) {
  if (job.kind === "uhd") {
    const v = meta.versions.find((x) => x.n === job.n);
    if (!v?.plan) throw new Error(`version ${job.n} has no plan snapshot`);
    return { snapshot: v.plan, file: `renders/v${job.n}-4k.mp4`, poster: null };
  }
  return { snapshot: `renders/v${job.n}.plan.json`, file: `renders/v${job.n}.mp4`, poster: `renders/v${job.n}.jpg` };
}

function launch(meta: VideoMeta, job: RenderJob) {
  const id = meta.id;
  const dir = videoDir(id);
  const { snapshot, file, poster } = jobFiles(meta, job);
  const snapshotFile = safeJoin(dir, snapshot);
  if (!fs.existsSync(snapshotFile)) throw new Error("the plan snapshot is missing");

  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const args = [tsx, "render/cli.ts", snapshotFile, dir, path.join(dir, file)];
  if (poster) args.push(path.join(dir, poster));
  if (job.scale !== 1) args.push("--scale", String(job.scale));
  const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
  const pid = child.pid ?? 0;
  Q.current = { id, key: job.key, pid };
  const setJob = (fn: (j: RenderJob) => void) =>
    updateMeta(id, (m) => {
      const j = m.jobs?.find((x) => x.key === job.key);
      if (j) fn(j);
      summarize(m);
    });
  setJob((j) => {
    j.status = "rendering";
    j.progress = 0;
    j.startedAt = new Date().toISOString();
    j.pid = pid;
  });

  let lastWrite = 0;
  let stderr = "";
  let stderrHead = "";
  let done: { durationInFrames: number; width?: number; height?: number } | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const p = line.match(/^PROGRESS ([\d.]+)/);
      if (p && Date.now() - lastWrite > 700) {
        lastWrite = Date.now();
        setJob((j) => {
          if (j.status === "rendering") j.progress = Number(p[1]);
        });
      }
      const d = line.match(/^DONE (.+)$/);
      if (d) done = JSON.parse(d[1]);
    }
  });
  child.stderr.on("data", (d) => {
    // Keep the start (where the "Error: ..." line usually is) and the tail (the stack).
    if (stderrHead.length < 16_000) stderrHead += d;
    stderr = (stderr + d).slice(-16_000);
  });
  const finish = (code: number | null) => {
    if (Q.current?.pid === pid) Q.current = null;
    const result = code === 0 ? done : null;
    if (!result) {
      // Never leave a half-written file where the media route would serve it.
      for (const f of [file, poster]) if (f) fs.rmSync(path.join(dir, f), { force: true });
    }
    updateMeta(id, (m) => {
      m.jobs = (m.jobs ?? []).filter((j) => j.key !== job.key);
      const now = new Date().toISOString();
      if (result) {
        // Metadata comes from the snapshot that was rendered, not from plan.json (which may have changed since).
        const plan = EditPlan.parse(JSON.parse(fs.readFileSync(snapshotFile, "utf8")));
        const { width, height } = DIMENSIONS[plan.aspect];
        if (job.kind === "uhd") {
          const v = m.versions.find((x) => x.n === job.n);
          if (v) v.uhd = { file, width: result.width ?? width * job.scale, height: result.height ?? height * job.scale, createdAt: now, scale: job.scale };
        } else {
          m.versions.push({
            n: job.n,
            file,
            poster: poster!,
            createdAt: now,
            durationSeconds: Math.round((result.durationInFrames / plan.fps) * 10) / 10,
            aspect: plan.aspect,
            plan: snapshot,
            width: result.width ?? width,
            height: result.height ?? height,
            ...(job.from !== undefined ? { from: job.from } : {}),
          });
          m.versions.sort((a, b) => a.n - b.n);
          m.title = plan.title;
          m.themeName = plan.themeName;
        }
        m.updatedAt = now;
      } else {
        m.renderError = { key: job.key, at: now, ...describeRenderError(stderrHead, stderr, code) };
      }
      summarize(m);
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
 * Turns the renderer's stderr into a one-line message (the first "Error: ..." line plus a line or two
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
 * Repairs render state left behind by a process that is gone: a job whose child died is dropped and
 * reported as interrupted (its pid is checked), and queued jobs this server doesn't know about (the
 * server restarted) are put back in the queue. Also converts the single-render state of older videos.
 */
export function recoverStaleRender(meta: VideoMeta): VideoMeta {
  let m = meta;
  // Older meta.json: one render in meta.render and no job list.
  if (!m.jobs && (m.render.status === "queued" || m.render.status === "rendering")) {
    const r = m.render;
    if (r.status === "rendering" && pidAlive(r.pid)) return m; // started by the previous code; it finishes on its own
    m =
      updateMeta(m.id, (x) => {
        const n = r.n;
        const snap = n ? path.join(videoDir(x.id), "renders", `v${n}.plan.json`) : null;
        if (r.status === "queued" && n && snap && fs.existsSync(snap)) {
          const plan = EditPlan.parse(JSON.parse(fs.readFileSync(snap, "utf8")));
          x.jobs = [{ key: `v${n}`, kind: "version", n, aspect: plan.aspect, scale: 1, status: "queued", progress: 0, queuedAt: r.queuedAt ?? new Date().toISOString() }];
        } else {
          x.renderError = { key: n ? `v${n}` : "render", error: "Render was interrupted. Try again.", at: new Date().toISOString() };
        }
        summarize(x);
      }) ?? m;
  }
  const dead = (m.jobs ?? []).filter((j) => {
    if (j.status !== "rendering") return false;
    if (Q.current && Q.current.id === m.id && Q.current.key === j.key && pidAlive(Q.current.pid)) return false;
    return j.pid ? !pidAlive(j.pid) : !!j.startedAt && Date.now() - Date.parse(j.startedAt) > 30 * 60_000;
  });
  if (dead.length) {
    for (const j of dead) if (Q.current?.id === m.id && Q.current.key === j.key) Q.current = null;
    m =
      updateMeta(m.id, (x) => {
        x.jobs = (x.jobs ?? []).filter((j) => !dead.some((d) => d.key === j.key));
        x.renderError = { key: dead[0].key, error: "Render was interrupted. Try again.", at: new Date().toISOString() };
        summarize(x);
      }) ?? m;
  }
  let requeued = false;
  for (const j of m.jobs ?? []) {
    if (j.status === "queued" && !Q.queue.some((e) => sameEntry(e, { id: m.id, key: j.key }))) {
      Q.queue.push({ id: m.id, key: j.key });
      requeued = true;
    }
  }
  if (dead.length || requeued) {
    pump();
    return readMeta(m.id) ?? m;
  }
  return m;
}
