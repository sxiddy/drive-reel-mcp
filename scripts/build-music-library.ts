/**
 * Analyses music/library/*.mp3 and writes music/library.json (bpm, first downbeat, duration,
 * energy curve, drop). Track metadata/licence lives in TRACKS below.
 * Run: npx tsx scripts/build-music-library.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { detectBeats, onsetEnvelope } from "../mcp/beats";
import { ffmpeg, probe } from "../mcp/media";
import type { StyleId } from "../shared/styles";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(ROOT, "music", "library");
const CC_BY = { license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" };

/** [title, stated BPM on incompetech, styles]. All Kevin MacLeod, incompetech.com. */
const TRACKS: [string, number, StyleId[]][] = [
  ["Brain Dance", 124, ["hype", "neon"]],
  ["Exit the Premises", 128, ["hype", "cinematic"]],
  ["Laserpack", 128, ["hype", "neon"]],
  ["Voltaic", 120, ["hype"]],
  ["Werq", 125, ["hype", "clean"]],
  ["Getting it Done", 135, ["hype", "clean"]],
  ["Voxel Revolution", 122, ["neon", "hype", "playful"]],
  ["Newer Wave", 110, ["neon", "nostalgic"]],
  ["Neon Laser Horizon", 160, ["neon"]],
  ["Glitter Blast", 100, ["playful"]],
  ["Island Meet and Greet", 100, ["playful"]],
  ["Americana", 104, ["cinematic", "elegant"]],
  ["Undaunted", 95, ["cinematic"]],
  ["Chill Wave", 100, ["nostalgic"]],
  ["Local Forecast - Slower", 77, ["nostalgic", "playful"]],
  ["Almost New", 80, ["elegant"]],
  ["Evening", 101, ["elegant", "clean"]],
  ["Aerosol of my Love", 100, ["clean", "nostalgic"]],
];

const fileFor = (title: string) => title.toLowerCase().replace(/ /g, "-") + ".mp3";

/** Short-term loudness (LUFS) every 0.1 s via ffmpeg ebur128. */
async function loudness(file: string): Promise<{ t: number; s: number }[]> {
  const { stderr } = await ffmpeg(["-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"]);
  const out: { t: number; s: number }[] = [];
  for (const m of stderr.matchAll(/t:\s*([\d.]+).*?S:\s*(-?[\d.]+|-inf)/g)) out.push({ t: +m[1], s: m[2] === "-inf" ? -70 : Math.max(-70, +m[2]) });
  return out;
}

/** Biggest sustained rise: mean loudness of the next 8 s minus the previous 8 s, snapped to a bar. */
function findDrop(l: { t: number; s: number }[], duration: number, bpm: number, offset: number) {
  const mean = (a: number, b: number) => {
    const xs = l.filter((p) => p.t >= a && p.t < b).map((p) => p.s);
    return xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
  };
  let best = { t: 0, rise: 0 };
  for (let t = 16; t < duration - 40; t += 0.5) {
    const rise = mean(t + 1, t + 9) - mean(t - 8, t);
    if (rise > best.rise) best = { t, rise };
  }
  if (best.rise < 1.5) return undefined; // < 1.5 LU: no real drop (these masters are dense)
  const bar = (4 * 60) / bpm;
  return { at: +(offset + Math.round((best.t - offset) / bar) * bar).toFixed(2), rise: +best.rise.toFixed(1) };
}

const RATE = 22050, HOP = 256, HS = HOP / RATE;

/** Fine tempo (±1.5%) and the downbeat phase whose 4-beat grid catches the most onset energy. */
async function refineGrid(file: string, bpm0: number) {
  const raw = path.join(os.tmpdir(), `lib-${process.pid}.f32`);
  await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  const env = onsetEnvelope(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const at = (t: number) => { const i = Math.round(t / HS); return (env[i] ?? 0) + 0.5 * ((env[i - 1] ?? 0) + (env[i + 1] ?? 0)); };
  let best = { bpm: bpm0, phase: 0, score: -Infinity };
  for (let b = bpm0 * 0.985; b <= bpm0 * 1.015; b += 0.02) {
    const beat = 60 / b;
    for (let ph = 0; ph < beat; ph += HS) {
      let s = 0, n = 0;
      for (let t = ph; t < env.length * HS; t += beat, n++) s += at(t);
      if (s / n > best.score) best = { bpm: b, phase: ph, score: s / n };
    }
  }
  const beat = 60 / best.bpm;
  // Downbeat: of the 4 beat positions in a bar, the one with the strongest onsets.
  let down = { k: 0, s: -Infinity };
  for (let k = 0; k < 4; k++) {
    let s = 0;
    for (let t = best.phase + k * beat; t < env.length * HS; t += 4 * beat) s += at(t);
    if (s > down.s) down = { k, s };
  }
  return { bpm: best.bpm, offset: best.phase + down.k * beat, fit: best.score / (2 * mean) };
}

async function main() {
  const out = [];
  for (const [title, stated, styles] of TRACKS) {
    const file = fileFor(title);
    const full = path.join(LIB, file);
    const duration = (await probe(full)).duration;
    const beats = await detectBeats(full);
    // Trust the detector when it agrees with incompetech's stated BPM (allowing half/double time),
    // otherwise start from the stated BPM; then refine tempo and downbeat on the whole track.
    let bpm = stated;
    for (const k of [1, 0.5, 2]) if (Math.abs(beats.bpm * k - stated) / stated < 0.03) { bpm = beats.bpm * k; break; }
    const grid = await refineGrid(full, bpm);
    const l = await loudness(full);
    const max = Math.max(...l.map((p) => p.s));
    const energyCurve: number[] = [];
    for (let t = 0; t < duration; t += 2) {
      const xs = l.filter((p) => p.t >= t && p.t < t + 2).map((p) => p.s);
      const m = xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
      energyCurve.push(+Math.max(0, Math.min(1, 1 - (max - m) / 30)).toFixed(2));
    }
    const drop = findDrop(l, duration, grid.bpm, grid.offset);
    const rec = {
      file, title, artist: "Kevin MacLeod",
      sourceUrl: `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(title)}.mp3`,
      ...CC_BY,
      credit: `"${title}" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`,
      styles, bpm: +grid.bpm.toFixed(2), statedBpm: stated, beatOffset: +grid.offset.toFixed(3), duration: +duration.toFixed(2),
      energyCurve, energyCurveStep: 2, ...(drop ? { dropAt: drop.at, dropRise: drop.rise } : {}),
    };
    console.log(title, rec.bpm, "offset", rec.beatOffset, "score", grid.fit.toFixed(2), "stated", stated, "detected", beats.bpm.toFixed(1), "drop", drop);
    out.push(rec);
  }
  fs.writeFileSync(path.join(ROOT, "music", "library.json"), JSON.stringify(out, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
