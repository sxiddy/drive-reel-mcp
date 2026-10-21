import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaptionCue } from "../shared/plan";
import { ffmpeg } from "./media";

/**
 * Speech-to-text for subtitles.
 *
 * The engine is NOT chosen yet: every candidate (whisper.cpp, faster-whisper, a cloud API) needs either a
 * model download or a new dependency, and that needs the user's approval. Until one is approved,
 * `isTranscriberAvailable()` is false, analysis skips transcription, and plans simply carry no captions.
 *
 * To add one: implement `Engine` (it gets a 16 kHz mono WAV, the input every common engine accepts, and
 * returns timed segments in seconds) and list it in ENGINES. Everything downstream (analysis stores the
 * cues on the clip, the planner copies them into scenes, Remotion renders them) already works.
 */
export type Cue = CaptionCue;

type Engine = {
  name: string;
  /** Cheap check (binary or model present, key set); never downloads anything. */
  available(): boolean;
  run(wav16kMono: string): Promise<Cue[]>;
};

const ENGINES: Engine[] = [];

const engine = () => ENGINES.find((e) => e.available());

export function isTranscriberAvailable(): boolean {
  return engine() !== undefined;
}

/** Timed subtitles for a media file's audio, ready to show (see toCaptionCues). Throws when no engine is set up. */
export async function transcribe(file: string): Promise<Cue[]> {
  const e = engine();
  if (!e) throw new Error("No speech-to-text engine is configured (see mcp/transcribe.ts).");
  const wav = path.join(os.tmpdir(), `stt-${process.pid}-${Date.now()}.wav`);
  try {
    await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    return toCaptionCues(await e.run(wav));
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

/** Subtitle readability limits (in line with common broadcast guidelines). */
export const CUE_LIMITS = { maxChars: 84, minSeconds: 0.8, maxSeconds: 6, gap: 0.04 };

/**
 * Turns raw engine segments into subtitle cues: whitespace tidied, empty segments dropped, long segments
 * split at word boundaries into cues of at most two ~42-character lines with time shared by length, cues
 * kept at least 0.8 s on screen where the next one allows, and overlaps removed.
 */
export function toCaptionCues(segments: Cue[], limits = CUE_LIMITS): Cue[] {
  const out: Cue[] = [];
  const sorted = segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(s.start, s.end), text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    const words = s.text.split(" ");
    const chunks: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > limits.maxChars) {
        chunks.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) chunks.push(cur);
    // Long segments that fit in one cue by length but run too long on screen get split by time too.
    const pieces = Math.max(chunks.length, Math.ceil((s.end - s.start) / limits.maxSeconds));
    const parts = pieces > chunks.length ? splitEvenly(words, pieces) : chunks;
    const total = parts.reduce((n, p) => n + p.length, 0);
    let t = s.start;
    for (const p of parts) {
      const len = ((s.end - s.start) * p.length) / total;
      out.push({ start: round3(t), end: round3(t + len), text: p });
      t += len;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const limit = next ? next.start - limits.gap : Infinity;
    if (out[i].end - out[i].start < limits.minSeconds) out[i].end = round3(Math.min(out[i].start + limits.minSeconds, limit));
    if (next && out[i].end > limit) out[i].end = round3(Math.max(out[i].start + 0.1, limit));
  }
  return out;
}

function splitEvenly(words: string[], n: number) {
  const parts: string[] = [];
  for (let k = 0; k < n; k++) {
    const p = words.slice(Math.round((k * words.length) / n), Math.round(((k + 1) * words.length) / n)).join(" ");
    if (p) parts.push(p);
  }
  return parts;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
