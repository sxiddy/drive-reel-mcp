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
  input: {
    source: string;
    occasion: string;
    duration: number;
    eventName?: string;
    place?: string;
    /** "library" (default): a royalty-free track; "own": the visitor's song (uploaded, or an audio file in the folder). */
    music?: "library" | "own";
    /** Song uploaded on the form (work/uploads/<songId>.<ext>). */
    songId?: string;
  };
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
  /** The downloaded footage was deleted to save disk; the published video keeps its own copy. */
  footageCleared?: boolean;
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

/** Uploaded songs: 24 random hex characters, stored as work/uploads/<id>.<ext>. */
export const isSongId = (id: string) => /^[a-f0-9]{24}$/.test(id);
export const SONG_EXTS = ["mp3", "wav", "m4a", "aac", "ogg"] as const;
export const MAX_SONG_BYTES = 40 * 1024 * 1024;

/** The audio format a file's first bytes say it is, or null when it isn't a supported audio file. */
export function sniffAudio(b: Uint8Array): (typeof SONG_EXTS)[number] | null {
  const str = (a: number, n: number) => String.fromCharCode(...b.subarray(a, a + n));
  if (b.length < 12) return null;
  if (str(0, 3) === "ID3") return "mp3";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WAVE") return "wav";
  if (str(0, 4) === "OggS") return "ogg";
  if (str(4, 4) === "ftyp" && /^(M4A |M4B |mp42|isom|mp41|dash|iso[2-6])$/.test(str(8, 4))) return "m4a";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac"; // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0) return "mp3"; // MPEG audio frame sync
  return null;
}

/** Path of an uploaded song, or null when the id is malformed or the file is gone. */
export function songPath(root: string, id: string): string | null {
  if (!isSongId(id)) return null;
  const dir = path.join(root, "work", "uploads");
  for (const ext of SONG_EXTS) {
    const f = path.join(dir, `${id}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
