import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FFMPEG: string = require("ffmpeg-static");

/** Streaming platforms (YouTube, Instagram, Spotify) normalise to about -14 LUFS; -1.5 dBTP leaves headroom for AAC. */
export const LOUDNESS_TARGET = { i: -14, tp: -1.5, lra: 11 } as const;
// The AAC encode after loudnorm can add a few hundredths of a dB of true peak; aim slightly lower to land under -1.5.
const TP_AIM = LOUDNESS_TARGET.tp - 0.5;

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-nostats", ...args], { windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-1500)}`))));
  });
}

/** True when the file has an audio stream (Remotion leaves it out when nothing in the composition makes sound). */
export async function hasAudioStream(file: string): Promise<boolean> {
  // `ffmpeg -i` with no output exits non-zero but still prints the stream list.
  const info = await ffmpeg(["-i", file]).catch((e: Error) => e.message);
  return /Stream #\d+:\d+(\[\w+\])?(\(\w+\))?: Audio:/.test(info);
}

type Measured = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

/** First loudnorm pass: measures the programme loudness without writing anything. */
async function measure(file: string): Promise<Measured> {
  const { i, lra } = LOUDNESS_TARGET;
  const tp = TP_AIM;
  const log = await ffmpeg(["-i", file, "-vn", "-af", `loudnorm=I=${i}:TP=${tp}:LRA=${lra}:print_format=json`, "-f", "null", "-"]);
  const json = log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1);
  return JSON.parse(json) as Measured;
}

/** Integrated loudness and true peak of a file, measured with ffmpeg's ebur128 filter. */
export async function measureLoudness(file: string): Promise<{ lufs: number; truePeak: number }> {
  const log = await ffmpeg(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1] ?? NaN);
  const truePeak = Number(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1] ?? NaN);
  return { lufs, truePeak };
}

/**
 * Normalises a rendered MP4's audio to -14 LUFS / -1.5 dBTP with a two-pass loudnorm (the measured
 * values make the second pass a clean linear gain where possible). The video stream is copied untouched.
 * Returns false when there is nothing to normalise (no audio, or digital silence).
 */
export async function normalizeLoudness(file: string): Promise<boolean> {
  if (!(await hasAudioStream(file))) return false;
  const m = await measure(file);
  const inputI = Number(m.input_i);
  if (!Number.isFinite(inputI) || inputI < -70) return false;

  const { i, lra } = LOUDNESS_TARGET;
  const tp = TP_AIM;
  const filter =
    `loudnorm=I=${i}:TP=${tp}:LRA=${lra}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true:print_format=summary`;
  const ext = path.extname(file);
  const tmp = path.join(path.dirname(file), `.${path.basename(file, ext)}.loudnorm-${process.pid}-${Date.now()}${ext}`);
  try {
    await ffmpeg([
      "-y",
      "-i", file,
      "-map", "0:v?", "-map", "0:a:0",
      "-c:v", "copy",
      "-af", filter,
      // loudnorm works at 192 kHz internally; bring it back to a delivery rate.
      "-ar", "48000",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      tmp,
    ]);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return true;
}
