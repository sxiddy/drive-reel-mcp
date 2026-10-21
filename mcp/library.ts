import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { occasionProfile } from "../shared/occasions";
import type { StyleId } from "../shared/styles";

/**
 * Bundled royalty-free music (music/library.json + music/library/*.mp3, built by
 * scripts/build-music-library.ts). Every track needs its `credit` shown with the video.
 */
export type LibraryTrack = {
  file: string;
  title: string;
  artist: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  /** Exact attribution text required by the licence. */
  credit: string;
  styles: StyleId[];
  bpm: number;
  /** Seconds of the first downbeat. */
  beatOffset: number;
  duration: number;
  /** Loudness 0..1 every `energyCurveStep` seconds. */
  energyCurve?: number[];
  energyCurveStep?: number;
  /** Seconds where the main drop / peak starts. */
  dropAt?: number;
  /** How much louder (LU) the 8 s after the drop are than the 8 s before; >= 2.5 is a real drop. */
  dropRise?: number;
  /** Absolute path of the audio file (filled by loadLibrary). */
  path: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "music");
const ENERGETIC: StyleId[] = ["hype", "neon"];
let cache: LibraryTrack[] | undefined;

/** Tracks from music/library.json whose audio file is present on disk. */
export function loadLibrary(dir = ROOT): LibraryTrack[] {
  if (dir === ROOT && cache) return cache;
  let raw: Omit<LibraryTrack, "path">[] = [];
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8"));
  } catch {
    return [];
  }
  const tracks = raw.map((t) => ({ ...t, path: path.join(dir, "library", t.file) })).filter((t) => fs.existsSync(t.path));
  if (dir === ROOT) cache = tracks;
  return tracks;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/**
 * Best track for a style/occasion/length. Score: primary style > secondary style > occasion's
 * styles; long enough (else it must loop); a drop for hype/neon; calm tracks for no-drum
 * occasions (memorials). Ties among near-best tracks are broken by `seed`, so different videos vary
 * but the same seed always gets the same track.
 */
export function pickTrack(styleId: StyleId, occasion: string, seconds: number, seed: string | number = "", tracks = loadLibrary()): LibraryTrack | undefined {
  if (!tracks.length) return undefined;
  const prof = occasionProfile(occasion);
  const calm = prof.music?.maxDrums === "none";
  const score = (t: LibraryTrack) => {
    let s = 0;
    const i = t.styles.indexOf(styleId);
    if (i === 0) s += 10;
    else if (i > 0) s += 7;
    else if (t.styles.some((x) => prof.styles.includes(x))) s += 3;
    if (t.styles.some((x) => prof.avoid.includes(x))) s -= 6;
    if (t.duration < seconds) s -= 3; // would have to loop
    if (ENERGETIC.includes(styleId)) {
      if (t.dropAt !== undefined && t.dropAt + Math.min(seconds, 20) <= t.duration) s += (t.dropRise ?? 3) >= 2.5 ? 3 : 1;
      if (t.bpm >= 118 && t.bpm <= 136) s += 1;
    }
    if (calm && (t.bpm > 115 || t.dropAt !== undefined)) s -= 2;
    return s;
  };
  const scored = tracks.map((t) => ({ t, s: score(t) }));
  const top = Math.max(...scored.map((x) => x.s));
  const pool = scored.filter((x) => x.s >= top - 1).sort((a, b) => a.t.file.localeCompare(b.t.file));
  // Best-scoring tracks are twice as likely as the near-misses.
  const weights = pool.map((x) => (x.s === top ? 2 : 1));
  let r = hash(`${styleId}|${occasion}|${seed}`) * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < pool.length; k++) if ((r -= weights[k]) < 0) return pool[k].t;
  return pool[pool.length - 1].t;
}

/**
 * Which part of the track to use for an N-second cut: starts on a bar, ends on a 4-bar phrase
 * boundary when one is within a bar of N (else on a bar), and for energetic styles includes the
 * drop about a third of the way in. If the track is shorter than N it returns the whole track (loop it).
 */
export function trackSegment(track: LibraryTrack, seconds: number, styleId?: StyleId): { start: number; end: number } {
  const beat = 60 / track.bpm;
  const bar = 4 * beat;
  const phrase = 4 * bar;
  const last = track.duration;
  if (seconds >= last - track.beatOffset) return { start: 0, end: last };
  const snap = (t: number, unit: number) => track.beatOffset + Math.round((t - track.beatOffset) / unit) * unit;
  const floorTo = (t: number, unit: number) => track.beatOffset + Math.floor((t - track.beatOffset) / unit + 1e-6) * unit;

  const energetic = styleId === undefined || ENERGETIC.includes(styleId);
  let start = track.beatOffset < bar ? 0 : track.beatOffset;
  if (energetic && track.dropAt !== undefined) {
    const lead = Math.min(seconds * 0.35, 2 * phrase);
    start = Math.max(0, floorTo(track.dropAt - lead, bar));
    if (start < track.beatOffset + bar / 2) start = track.beatOffset < bar ? 0 : track.beatOffset;
  }
  const grid0 = start === 0 ? track.beatOffset : start;
  const pEnd = grid0 + Math.round((start + seconds - grid0) / phrase) * phrase;
  let end = Math.abs(pEnd - (start + seconds)) <= bar ? pEnd : snap(start + seconds, bar);
  if (end > last) {
    // Slide earlier so the cut still fits.
    const len = end - start;
    start = Math.max(0, floorTo(last - len, bar));
    end = Math.min(last, start + len);
  }
  return { start: +start.toFixed(3), end: +end.toFixed(3) };
}
