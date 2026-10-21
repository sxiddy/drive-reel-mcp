import fs from "node:fs";
import path from "node:path";
import type { StyleId } from "./styles";

/**
 * A video being made from the website: link in → themes → the visitor's pick → rendered video.
 * The worker process (pipeline/worker.ts) writes status.json in the project folder as it goes;
 * the website only reads it.
 */
export type MakeStep = "queued" | "analyzing" | "themes" | "choose" | "rendering" | "done" | "error";

export type MakeTheme = {
  id: string;
  name: string;
  pitch: string;
  story: string;
  occasionFit: string;
  styleId: StyleId;
  styleName: string;
  title: string;
  aspect: string;
  shots: number;
  preview: boolean;
};

export type MakeStatus = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: { source: string; occasion: string; duration: number };
  step: MakeStep;
  /** What is happening right now, e.g. "Watching clip 3 of 9". */
  stage: string;
  /** 0–1 within the current step. */
  progress: number;
  error?: string;
  /** Worker process id while it runs, so a crashed worker can be noticed. */
  pid?: number;
  stats?: { clips: number; photos: number; audio: number; footageSeconds: number };
  themes?: MakeTheme[];
  /** "claude" when Claude wrote the themes, "auto" when they came from the built-in rules. */
  themesBy?: "claude" | "auto";
  themesNote?: string;
  /** "Just make it": render the first theme as soon as themes exist, without asking. */
  auto?: boolean;
  chosen?: string;
  result?: { videoId: string; editKey?: string; durationSeconds: number };
};

/** Website project ids are long random strings: knowing one is what lets you see and steer it. */
export const isMakeId = (id: string) => /^web-[a-f0-9]{24}$/.test(id);

export const statusFile = (projectDir: string) => path.join(projectDir, "status.json");

export function readStatus(projectDir: string): MakeStatus | null {
  // A read can race the worker's write on Windows; one retry covers it.
  for (let i = 0; i < 2; i++) {
    try {
      return JSON.parse(fs.readFileSync(statusFile(projectDir), "utf8")) as MakeStatus;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    }
  }
  return null;
}

export function writeStatus(projectDir: string, s: MakeStatus) {
  const file = statusFile(projectDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows refuses to replace a file another process has open; write in place instead.
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

/** Only Google Drive links: the website must never be pointed at this machine's own files. */
export function isDriveLink(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" && (u.hostname === "drive.google.com" || u.hostname === "docs.google.com");
  } catch {
    return false;
  }
}
