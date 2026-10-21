import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isMakeId, readStatus, writeStatus, type MakeStatus } from "@/shared/make";
import { ROOT, pidAlive } from "./store";

/**
 * The website's "make a video" jobs. Each runs pipeline/worker.ts in its own process (analysis and
 * rendering take minutes and lean on ffmpeg and Remotion), which reports through status.json.
 */

export const PROJECTS = path.join(ROOT, "work", "projects");
/** Analyses and renders are heavy; more than this at once and the laptop crawls. */
const MAX_RUNNING = 2;

export function makeDir(id: string) {
  if (!isMakeId(id)) throw new Error("bad id");
  return path.join(PROJECTS, id);
}

/** How long finished footage stays, so the visitor can still try another theme. */
const KEEP_FOOTAGE_MS = 60 * 60_000;
/** Themes nobody picked from in a day are abandoned. */
const KEEP_UNCHOSEN_MS = 24 * 60 * 60_000;
/** Downloads and working copies; everything else in a project dir is a few KB. */
const FOOTAGE_DIRS = ["source", "assets"];

/**
 * Frees disk: deletes the downloaded footage of website jobs that finished (or failed) over an hour
 * ago, or that sat on the theme picker for a day. The published video lives in data/videos with its own assets, so watching and editing keep working.
 */
export function sweepFootage(now = Date.now()) {
  if (!fs.existsSync(PROJECTS)) return;
  for (const id of fs.readdirSync(PROJECTS)) {
    if (!isMakeId(id)) continue;
    const dir = makeDir(id);
    const s = readStatus(dir);
    if (!s || s.footageCleared) continue;
    const keep = s.step === "done" || s.step === "error" ? KEEP_FOOTAGE_MS : s.step === "choose" ? KEEP_UNCHOSEN_MS : null;
    if (keep === null || now - Date.parse(s.updatedAt) < keep) continue;
    for (const d of FOOTAGE_DIRS) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
    writeStatus(dir, { ...s, footageCleared: true });
  }
}

const g = globalThis as { __footageSweep?: NodeJS.Timeout };
if (!g.__footageSweep) {
  g.__footageSweep = setInterval(() => {
    try {
      sweepFootage();
    } catch (e) {
      console.error("footage sweep failed", e);
    }
  }, 10 * 60_000);
  g.__footageSweep.unref();
}

const RUNNING_STEPS: MakeStatus["step"][] = ["queued", "analyzing", "themes", "rendering"];
const isRunning = (s: MakeStatus) => RUNNING_STEPS.includes(s.step);

/** Status with a crashed worker turned into a readable error instead of an endless spinner. */
export function liveStatus(id: string): MakeStatus | null {
  const dir = makeDir(id);
  const s = readStatus(dir);
  if (!s) return null;
  // Give a just-spawned worker a moment to write its pid.
  const fresh = Date.now() - Date.parse(s.updatedAt) < 15_000;
  if (isRunning(s) && !fresh && !pidAlive(s.pid)) {
    const back = s.step === "rendering" && s.themes?.length;
    const fixed: MakeStatus = { ...s, step: back ? "choose" : "error", stage: "Failed", progress: 0, error: "The job stopped unexpectedly. Try again.", pid: undefined };
    writeStatus(dir, fixed);
    return fixed;
  }
  return s;
}

/** What browsers see: everything except the worker's process id. */
export const publicStatus = (s: MakeStatus) => ({ ...s, pid: undefined });

type Live = { id: string; pid: number };
const G = globalThis as unknown as { __driveReelMakers?: Live[] };
const running = (G.__driveReelMakers ??= []);

function busy() {
  for (let i = running.length - 1; i >= 0; i--) if (!pidAlive(running[i].pid)) running.splice(i, 1);
  return running.length >= MAX_RUNNING;
}

function launch(id: string, args: string[]) {
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const log = fs.openSync(path.join(makeDir(id), "worker.log"), "a");
  const port = process.env.PORT ?? "3000";
  const child = spawn(process.execPath, [tsx, "pipeline/worker.ts", ...args], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["ignore", log, log],
    // The worker publishes back to this server; talk to it locally even when SITE_URL is public.
    env: { ...process.env, SITE_URL: `http://127.0.0.1:${port}` },
  });
  fs.closeSync(log);
  if (child.pid) running.push({ id, pid: child.pid });
  child.on("exit", () => {
    const i = running.findIndex((r) => r.pid === child.pid);
    if (i >= 0) running.splice(i, 1);
  });
  return child.pid;
}

export class MakeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Starts analysing a Drive folder. `auto` renders Claude's first theme straight away ("Just make it"). */
export function startMake(input: { source: string; occasion: string; duration: number; auto: boolean }): MakeStatus {
  try {
    sweepFootage();
  } catch (e) {
    console.error("footage sweep failed", e);
  }
  if (busy()) throw new MakeError("Drive Reel is busy making other videos. Try again in a few minutes.", 429);
  const id = `web-${crypto.randomBytes(12).toString("hex")}`;
  const dir = makeDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  // Same shape as mcp/projects.ts so the MCP tools can open website projects too.
  const project = { id, mode: "drive", source: input.source, occasion: input.occasion, targetDuration: input.duration, createdAt: now, themes: [], videos: [] };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  const status: MakeStatus = {
    id,
    createdAt: now,
    updatedAt: now,
    input: { source: input.source, occasion: input.occasion, duration: input.duration },
    step: "queued",
    stage: "Starting",
    progress: 0,
    auto: input.auto,
  };
  writeStatus(dir, status);
  const pid = launch(id, ["analyze", id, ...(input.auto ? ["--auto"] : [])]);
  if (!pid) throw new MakeError("Could not start the job.", 500);
  return status;
}

/** Renders the theme the visitor picked. */
export function startGenerate(id: string, themeId: string): MakeStatus {
  const s = liveStatus(id);
  if (!s) throw new MakeError("not found", 404);
  if (s.step !== "choose" && s.step !== "done") throw new MakeError(s.step === "rendering" ? "A video is already being made." : "Themes aren't ready yet.", 409);
  if (s.footageCleared) throw new MakeError("This footage was cleared to save space. Start a new video from the same link to try another cut.", 410);
  if (!s.themes?.some((t) => t.id === themeId)) throw new MakeError("Unknown theme.", 400);
  if (busy()) throw new MakeError("Drive Reel is busy making other videos. Try again in a few minutes.", 429);
  const next: MakeStatus = { ...s, step: "rendering", chosen: themeId, stage: "Starting", progress: 0, error: undefined, result: undefined };
  writeStatus(makeDir(id), next);
  if (!launch(id, ["generate", id, themeId])) throw new MakeError("Could not start the render.", 500);
  return next;
}
