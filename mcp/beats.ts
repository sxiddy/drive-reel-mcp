import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "./media";

const RATE = 22050;
const HOP = 256; // ≈11.6 ms per onset-envelope step

/**
 * Onset envelope: how sharply loudness rises in each short frame (kicks, snares and strums spike).
 * Exported for tests; `detectBeats` is the entry point.
 */
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const n = Math.floor(samples.length / HOP);
  const env = new Float32Array(n);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = i * HOP; k < (i + 1) * HOP; k++) e += samples[k] * samples[k];
    const db = Math.log10(e / HOP + 1e-10);
    env[i] = Number.isNaN(prev) ? 0 : Math.max(0, db - prev);
    prev = db;
  }
  return env;
}

/**
 * Tempo and beat phase from an onset envelope: autocorrelation picks the beat period (weighted
 * towards 90–140 BPM, where most songs sit, to avoid half/double-time picks), then the offset whose
 * grid lines up with the most onsets gives where beat one falls.
 */
export function tempoFromEnvelope(env: Float32Array, hopSeconds = HOP / RATE): { bpm: number; offset: number } {
  const minLag = Math.floor(60 / 180 / hopSeconds);
  const maxLag = Math.ceil(60 / 70 / hopSeconds);
  let best = { lag: minLag, score: -Infinity };
  let mean = 0;
  for (const v of env) mean += v;
  mean /= Math.max(1, env.length);
  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += (env[i] - mean) * (env[i - lag] - mean);
    return s / Math.max(1, env.length - lag);
  };
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Comb: a true beat period also lines up at 2× and 4× (bars), which half-beat periods don't.
    const s = ac(lag) + 0.5 * ac(2 * lag) + 0.25 * ac(4 * lag);
    const bpm = 60 / (lag * hopSeconds);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.6) ** 2);
    scores.push(s);
    if (s * prior > best.score) best = { lag, score: s * prior };
  }
  // Refine to a fractional lag with a parabola through the peak and its neighbours.
  const i0 = best.lag - minLag;
  const [a, b, c] = [scores[i0 - 1] ?? scores[i0], scores[i0], scores[i0 + 1] ?? scores[i0]];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const lag = best.lag + Math.max(-0.5, Math.min(0.5, shift));
  const bpm = 60 / (lag * hopSeconds);

  let bestOffset = { k: 0, score: -Infinity };
  for (let k = 0; k < Math.round(lag); k++) {
    let s = 0;
    for (let t = k; t < env.length; t += lag) s += env[Math.round(t)] ?? 0;
    if (s > bestOffset.score) bestOffset = { k, score: s };
  }
  return {
    bpm: Math.round(bpm * 10) / 10,
    offset: Math.round(bestOffset.k * hopSeconds * 1000) / 1000,
  };
}

/** Detects tempo and the first beat of a song (first 90 s). */
export async function detectBeats(file: string): Promise<{ bpm: number; offset: number }> {
  const raw = path.join(os.tmpdir(), `beats-${process.pid}-${Date.now()}.f32`);
  try {
    await ffmpeg(["-i", file, "-t", "90", "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
    const buf = fs.readFileSync(raw);
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    return tempoFromEnvelope(onsetEnvelope(samples));
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/** Short-term loudness (LUFS) every 0.1 s via ffmpeg ebur128. */
async function shortTermLoudness(file: string): Promise<{ t: number; s: number }[]> {
  const { stderr } = await ffmpeg(["-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"]);
  const out: { t: number; s: number }[] = [];
  for (const m of stderr.matchAll(/t:\s*([\d.]+).*?S:\s*(-?[\d.]+|-inf)/g)) out.push({ t: +m[1], s: m[2] === "-inf" ? -70 : Math.max(-70, +m[2]) });
  return out;
}

/**
 * The song's drop: the biggest sustained loudness rise (mean of the next 8 s minus the previous 8 s, at
 * least 1.5 LU), snapped to a bar of the beat grid. Same rule the music library was built with.
 */
export function findDrop(l: { t: number; s: number }[], duration: number, bpm: number, offset: number): number | undefined {
  const mean = (a: number, b: number) => {
    const xs = l.filter((p) => p.t >= a && p.t < b).map((p) => p.s);
    return xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
  };
  let best = { t: 0, rise: 0 };
  for (let t = 16; t < duration - 20; t += 0.5) {
    const rise = mean(t + 1, t + 9) - mean(t - 8, t);
    if (rise > best.rise) best = { t, rise };
  }
  if (best.rise < 1.5) return undefined;
  const bar = (4 * 60) / bpm;
  return +(offset + Math.round((best.t - offset) / bar) * bar).toFixed(2);
}

export async function detectDrop(file: string, duration: number, bpm: number, offset: number): Promise<number | undefined> {
  return findDrop(await shortTermLoudness(file), duration, bpm, offset);
}
