import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const FFMPEG: string = require("ffmpeg-static");
export const FFPROBE: string = require("ffprobe-static").path;

export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      stderr += d;
      // ffmpeg's metadata=print output can be large; keep only the tail we might need for errors.
      if (stderr.length > 40_000_000) stderr = stderr.slice(-20_000_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    p.on("error", reject);
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited with ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export const ffmpeg = (args: string[], timeoutMs = 15 * 60_000) => run(FFMPEG, ["-hide_banner", "-y", ...args], { timeoutMs });

export type Probe = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codec?: string;
  /** Transfer characteristic, e.g. "arib-std-b67" (HLG) or "smpte2084" (PQ) for HDR phone footage. */
  colorTransfer?: string;
  /** Container and video-stream tags (creation_time, com.apple.quicktime.creationdate, …). */
  tags?: Record<string, string>;
};

export const isHdr = (p: Pick<Probe, "colorTransfer">) => p.colorTransfer === "arib-std-b67" || p.colorTransfer === "smpte2084";

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  const j = JSON.parse(stdout) as {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: { codec_type: string; codec_name?: string; color_transfer?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string; tags?: { rotate?: string } & Record<string, string>; side_data_list?: { rotation?: number }[] }[];
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? 0) || 0,
    width: (swap ? v?.height : v?.width) ?? 0,
    height: (swap ? v?.width : v?.height) ?? 0,
    fps: den ? num / den : 0,
    hasVideo: !!v,
    hasAudio: !!a,
    codec: v?.codec_name,
    colorTransfer: v?.color_transfer,
    tags: { ...(v?.tags ?? {}), ...(j.format?.tags ?? {}) },
  };
}

const SCALE_1080 = "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'";

/** HDR (HLG/PQ) iPhone footage looks washed-out grey when squeezed into SDR; tonemap it to BT.709 first. */
const tonemap = (transfer: string) =>
  `zscale=tin=${transfer}:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv`;

/**
 * 1080p-max, 30 fps H.264 proxy: fast to analyse, render and stream in the editor.
 * Long clips (stage recordings) are proxied as a few segments spread across the whole clip,
 * joined back to back, so the edit can use the end of a talk and not only its first minutes.
 */
export async function makeVideoProxy(src: string, out: string, opts: { hdrTransfer?: string; hasAudio: boolean; segments?: { start: number; length: number }[] }) {
  const vf = [opts.hdrTransfer ? tonemap(opts.hdrTransfer) : "", SCALE_1080, "fps=30", "format=yuv420p", "setsar=1"].filter(Boolean).join(",");
  // Phone clips are often variable frame rate: force constant 30 fps and stretch/squeeze the audio to the
  // timestamps, so picture and sound stay in sync and trims land where the analysis measured.
  const sync = ["-fps_mode", "cfr", ...(opts.hasAudio ? ["-af", "aresample=async=1"] : [])];
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
  const segs = opts.segments ?? [];
  if (segs.length <= 1) {
    const cut = segs[0] ? ["-ss", String(segs[0].start), "-t", String(segs[0].length)] : [];
    await ffmpeg([...cut, "-i", src, "-vf", vf, ...sync, "-ac", "2", "-ar", "48000", ...enc]);
    return;
  }
  const inputs = segs.flatMap((g) => ["-ss", String(g.start), "-t", String(g.length), "-i", src]);
  const graph = segs.map((_, i) => `[${i}:v]${vf}[v${i}]` + (opts.hasAudio ? `;[${i}:a]aresample=48000:async=1,aformat=channel_layouts=stereo[a${i}]` : "")).join(";");
  const join = segs.map((_, i) => `[v${i}]` + (opts.hasAudio ? `[a${i}]` : "")).join("");
  const concat = `${join}concat=n=${segs.length}:v=1:a=${opts.hasAudio ? 1 : 0}[v]${opts.hasAudio ? "[a]" : ""}`;
  await ffmpeg([...inputs, "-filter_complex", `${graph};${concat}`, "-map", "[v]", ...(opts.hasAudio ? ["-map", "[a]"] : []), "-fps_mode", "cfr", ...enc]);
}

/** Re-encodes a proxy turned `rotate` degrees clockwise (a phone clip filmed sideways without a rotation flag). */
export async function rotateVideoProxy(file: string, rotate: 90 | 270) {
  const tmp = file.replace(/\.mp4$/, ".rot.mp4");
  await ffmpeg(["-i", file, "-vf", rotate === 90 ? "transpose=1" : "transpose=2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "copy", "-movflags", "+faststart", tmp]);
  fs.renameSync(tmp, file);
}

/**
 * EXIF orientation (1–8) of a JPEG, read from its APP1 segment; 1 when absent or not a JPEG. Phones store
 * portrait photos landscape and set this flag, so without it a portrait shot comes out sideways.
 */
export function exifOrientation(buf: Buffer): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xda) break; // start of scan: no more metadata
    if (marker === 0xe1 && buf.toString("latin1", i + 4, i + 8) === "Exif" && buf[i + 8] === 0 && buf[i + 9] === 0) {
      const t = i + 10;
      const le = buf.toString("latin1", t, t + 2) === "II";
      const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      if (ifd + 2 > buf.length) return 1;
      for (let k = 0, n = u16(ifd); k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > buf.length) break;
        if (u16(e) === 0x0112) {
          const o = u16(e + 8);
          return o >= 1 && o <= 8 ? o : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** ffmpeg filters that turn an EXIF-oriented image upright. */
export const ORIENT_FILTER: Record<number, string> = {
  2: "hflip",
  3: "hflip,vflip",
  4: "vflip",
  5: "transpose=0",
  6: "transpose=1",
  7: "transpose=3",
  8: "transpose=2",
};

/** Upright, at most 2160 px wide JPEG. Orientation is applied explicitly (autorotation off) so it happens exactly once. */
export async function makeImageProxy(src: string, out: string) {
  let head: Buffer;
  try {
    const fd = fs.openSync(src, "r");
    head = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    head = head.subarray(0, n);
  } catch {
    head = Buffer.alloc(0);
  }
  const orient = ORIENT_FILTER[exifOrientation(head)];
  const vf = [orient, "scale='min(2160,iw)':-2"].filter(Boolean).join(",");
  await ffmpeg(["-noautorotate", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", out]);
}

/**
 * Exposure and sharpness of a still, measured like clip frames (640 px wide, same edge detector), so they
 * compare with each other and with clips. luma 0..1; detail is edge density.
 */
export async function imageQuality(file: string): Promise<{ luma: number; detail: number }> {
  const { stderr } = await ffmpeg([
    "-i", file,
    "-vf", "scale=640:-2,format=yuv420p,signalstats,metadata=print,format=gray,edgedetect=low=0.08:high=0.2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-frames:v", "1", "-f", "null", "-",
  ]);
  const [s] = parseFrameStats(stderr);
  if (!s) throw new Error("no stats for image");
  return { luma: round3(colorOfFrame(s).luma), detail: Math.round(s.edges * 10) / 10 };
}

export async function makeAudioProxy(src: string, out: string) {
  await ffmpeg(["-i", src, "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000", out]);
}

/** Loudness per half-second window, in dBFS (−90 when silent). */
export async function audioEnergy(file: string): Promise<number[]> {
  const { stderr } = await ffmpeg([
    "-i", file, "-vn",
    "-af", "aresample=8000,asetnsamples=n=4000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-",
  ]);
  return [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -90 : Math.max(-90, Number(m[1]))));
}

/**
 * One sampled frame. luma/lumaLo/lumaHi/u/v/sat are raw 8-bit limited-range values as signalstats reports
 * them (Y 16–235, chroma centred on 128); `colorOf` turns them into display terms.
 */
export type FrameStat = { t: number; score: number; luma: number; edges: number; lumaLo: number; lumaHi: number; u: number; v: number; sat: number };

/** Signalstats keys read from the first (colour) print of each frame. */
const COLOR_KEYS = { YAVG: "luma", YLOW: "lumaLo", YHIGH: "lumaHi", UAVG: "u", VAVG: "v", SATAVG: "sat" } as const;

/** Parses `metadata=print` output from frameStats/imageColor. The edge map's YAVG is the second print of a frame. */
export function parseFrameStats(stderr: string): FrameStat[] {
  const byTime = new Map<string, FrameStat & { seen: number }>();
  let cur: (FrameStat & { seen: number }) | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) {
      cur = byTime.get(t[1]);
      if (!cur) byTime.set(t[1], (cur = { t: Number(t[1]), score: 0, luma: 128, edges: 0, lumaLo: 128, lumaHi: 128, u: 128, v: 128, sat: 0, seen: 0 }));
      cur.seen++;
      continue;
    }
    const kv = cur && line.match(/lavfi\.(scene_score|signalstats\.(YAVG|YLOW|YHIGH|UAVG|VAVG|SATAVG))=([\d.]+)/);
    if (!cur || !kv) continue;
    const value = Number(kv[3]);
    if (kv[1] === "scene_score") cur.score = value;
    else if (cur.seen === 1) cur[COLOR_KEYS[kv[2] as keyof typeof COLOR_KEYS]] = value;
    else if (kv[2] === "YAVG") cur.edges = value;
  }
  return [...byTime.values()].map(({ seen: _seen, ...rest }) => rest).sort((x, y) => x.t - y.t);
}

/**
 * One pass, 4 samples a second: scene-change score (0 = static, 1 = hard cut), brightness and colour
 * (signalstats already measures chroma and saturation, so the colour match costs nothing extra) and edge
 * density (how much fine detail survives; motion blur and shaky pans drop it), so the planner can avoid
 * dark or smeared moments and match colour between clips.
 */
export async function frameStats(file: string): Promise<FrameStat[]> {
  const { stderr } = await ffmpeg([
    "-i", file, "-an",
    "-vf",
    "fps=4,scale=640:-2,select='gte(scene,0)',signalstats,metadata=print," +
      "format=gray,edgedetect=low=0.08:high=0.2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f", "null", "-",
  ]);
  return parseFrameStats(stderr);
}

/**
 * Average colour in display terms. luma: 0 = black, 1 = white (mean of the picture). u/v: mean chroma
 * offset, 0 = neutral (+u = bluer, −u = yellower, +v = redder/magenta, −v = greener/cyan); a non-zero
 * mean over a whole shot is mostly white-balance cast. sat: mean chroma magnitude (0 = grey, ~0.1 = vivid).
 */
export type ColorStat = { luma: number; u: number; v: number; sat: number };

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Display-terms colour of one frame sample (limited-range 8-bit in). */
export function colorOfFrame(s: Pick<FrameStat, "luma" | "u" | "v" | "sat">): ColorStat {
  return { luma: Math.max(0, Math.min(1, (s.luma - 16) / 219)), u: (s.u - 128) / 224, v: (s.v - 128) / 224, sat: s.sat / 224 };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Representative colour of a set of samples: the per-channel median, ignoring frames that are almost black
 * (fades, lens covered), whose chroma is noise. Falls back to all frames when every frame is dark.
 */
export function colorOf(samples: ColorStat[]): ColorStat {
  const lit = samples.filter((c) => c.luma > 0.06);
  const use = lit.length ? lit : samples;
  const pick = (k: keyof ColorStat) => round3(median(use.map((c) => c[k])));
  return { luma: pick("luma"), u: pick("u"), v: pick("v"), sat: pick("sat") };
}

/** Colour of a still. JPEG decodes full-range; `format=yuv420p` converts it to limited range so photos and clips compare directly. */
export async function imageColor(file: string): Promise<ColorStat> {
  const { stderr } = await ffmpeg(["-i", file, "-vf", "scale=640:-2,format=yuv420p,signalstats,metadata=print", "-frames:v", "1", "-f", "null", "-"]);
  const [s] = parseFrameStats(stderr);
  if (!s) throw new Error("no colour stats for image");
  return colorOf([colorOfFrame(s)]);
}

/** Mono float PCM of a file's audio, at `rate` Hz. */
export async function decodeMono(file: string, rate: number): Promise<Float32Array> {
  const raw = path.join(os.tmpdir(), `pcm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.f32`);
  try {
    await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", raw]);
    const buf = fs.readFileSync(raw);
    // Copy out of the Buffer's pool so the array is 4-byte aligned whatever the Buffer's offset.
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + Math.floor(buf.byteLength / 4) * 4));
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Speech detection
// ---------------------------------------------------------------------------------------------------------

export const SPEECH_RATE = 16000;
/** Analysis frame: 20 ms, about one pitch period of the lowest voices times a few. */
const SPEECH_HOP_S = 0.02;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ audio-EQ-cookbook 2nd-order Butterworth high/low-pass. */
function butter(kind: "high" | "low", f0: number, rate: number): Biquad {
  const w = (2 * Math.PI * f0) / rate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  const b1 = kind === "low" ? 1 - c : -(1 + c);
  const b0 = kind === "low" ? (1 - c) / 2 : (1 + c) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/**
 * Tuning for detectSpeech. Exported so tests and callers can see what "speech" means here.
 * - voiceRatioDb: the 300–3400 Hz telephone band must carry at least this share of the energy
 *   (−7 dB ≈ 20%); wind rumble, traffic and hiss fail it.
 * - aboveFloorDb: the voice band must be this far above the clip's own noise floor (its 10th percentile).
 * - minLevelDb: and above this absolute level (dBFS), so a silent clip's floor noise never counts.
 * - syllableRangeDb: speech switches on and off 3–6 times a second, so within ±0.5 s its voice-band level
 *   spans a wide range (90th − 10th percentile); sustained music, engines and crowd roar are much steadier.
 */
export const SPEECH_TUNING = {
  voiceRatioDb: -7,
  aboveFloorDb: 10,
  minLevelDb: -52,
  syllableRangeDb: 11,
  /**
   * Voiced speech is periodic at the speaker's pitch (70–400 Hz) below ~900 Hz: normalised autocorrelation
   * of that band must reach this. Bird song, hiss and clatter are aperiodic or pitched far higher.
   */
  periodicity: 0.5,
  /** Share of frames within ±0.25 s that must be voiced (consonants and short gaps are not). */
  vote: 0.4,
  minSegment: 0.4,
  bridgeGap: 0.3,
  pad: 0.08,
};

/**
 * Peak normalised autocorrelation of x[start, start+len) over lags [minLag, maxLag]: ~1 for a clean pitched
 * sound with its period in range, ~0 for noise.
 */
function periodicityAt(x: Float32Array, start: number, len: number, minLag: number, maxLag: number) {
  if (start < 0 || start + len + maxLag + 1 > x.length) return 0;
  let best = 0;
  let e0 = 0;
  for (let k = start; k < start + len; k++) e0 += x[k] * x[k];
  if (e0 <= 1e-12) return 0;
  // Energy of the lagged window, slid along instead of recomputed.
  let el = 0;
  for (let k = start + minLag; k < start + minLag + len; k++) el += x[k] * x[k];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let k = start; k < start + len; k++) c += x[k] * x[k + lag];
    const r = c / Math.sqrt(e0 * el + 1e-20);
    if (r > best) best = r;
    el += x[start + lag + len] * x[start + lag + len] - x[start + lag] * x[start + lag];
  }
  return best;
}

/**
 * Where someone is talking, as [start, end] seconds. A frame is voice-like when the telephone band is loud
 * against the floor and dominates the spectrum; a moment is speech when most frames within ±0.25 s are
 * voice-like and the level has the deep syllabic dips speech has and music doesn't. Segments closer than
 * 0.3 s are bridged into one phrase (the pauses between words), blips under 0.4 s are dropped and the
 * result is padded a little, since soft onsets and word endings sit under the threshold.
 */
export function detectSpeech(samples: Float32Array, rate = SPEECH_RATE, tuning = SPEECH_TUNING): [number, number][] {
  const hop = Math.max(1, Math.round(rate * SPEECH_HOP_S));
  const n = Math.floor(samples.length / hop);
  if (n < 10) return [];
  const full = filter(samples, butter("high", 60, rate));
  let voice = filter(filter(samples, butter("high", 300, rate)), butter("high", 300, rate));
  voice = filter(filter(voice, butter("low", 3400, rate)), butter("low", 3400, rate));
  const ev: number[] = new Array(n);
  const ef: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sv = 0;
    let sf = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) {
      sv += voice[k] * voice[k];
      sf += full[k] * full[k];
    }
    ev[i] = 10 * Math.log10(sv / hop + 1e-12);
    ef[i] = 10 * Math.log10(sf / hop + 1e-12);
  }
  const floor = percentile([...ev].sort((a, b) => a - b), 0.1);
  // Pitch band: low-passed, then decimated to ~8 kHz so the autocorrelation stays cheap.
  const dec = Math.max(1, Math.floor(rate / 8000));
  const low = filter(filter(full, butter("low", 900, rate)), butter("low", 900, rate));
  const pitch = new Float32Array(Math.floor(low.length / dec)).map((_, k) => low[k * dec]);
  const pr = rate / dec;
  const pLen = Math.round(pr * 0.04);
  const [minLag, maxLag] = [Math.floor(pr / 400), Math.ceil(pr / 70)];
  const voiced = ev.map((e, i) => {
    if (!(e > Math.max(floor + tuning.aboveFloorDb, tuning.minLevelDb) && e - ef[i] > tuning.voiceRatioDb)) return false;
    const centre = Math.round(((i + 0.5) * hop) / dec);
    return periodicityAt(pitch, centre - (pLen >> 1), pLen, minLag, maxLag) >= tuning.periodicity;
  });

  const halfSyll = Math.round(0.5 / SPEECH_HOP_S);
  const halfVote = Math.round(0.25 / SPEECH_HOP_S);
  // Prefix sums for the ±0.25 s vote.
  const pre = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (voiced[i] ? 1 : 0);
  const speech = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - halfVote);
    const b = Math.min(n, i + halfVote + 1);
    if ((pre[b] - pre[a]) / (b - a) < tuning.vote) continue;
    const win = ev.slice(Math.max(0, i - halfSyll), Math.min(n, i + halfSyll + 1)).sort((x, y) => x - y);
    speech[i] = percentile(win, 0.9) - percentile(win, 0.1) >= tuning.syllableRangeDb;
  }

  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!speech[i]) continue;
    let j = i;
    while (j + 1 < n && speech[j + 1]) j++;
    raw.push([i * SPEECH_HOP_S, (j + 1) * SPEECH_HOP_S]);
    i = j;
  }
  const merged: [number, number][] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg[0] - last[1] < tuning.bridgeGap) last[1] = seg[1];
    else merged.push([...seg]);
  }
  const total = samples.length / rate;
  return merged
    .filter(([a, b]) => b - a >= tuning.minSegment)
    .map(([a, b]) => [round3(Math.max(0, a - tuning.pad)), round3(Math.min(total, b + tuning.pad))] as [number, number]);
}

/** Speech windows of a media file's audio track. */
export async function speechWindows(file: string): Promise<[number, number][]> {
  return detectSpeech(await decodeMono(file, SPEECH_RATE), SPEECH_RATE);
}

/** One image with `cols × rows` frames sampled evenly across the clip, so Claude can see what's in it. */
export async function contactSheet(file: string, duration: number, out: string, cols = 4, rows = 2) {
  const n = cols * rows;
  const rate = n / Math.max(duration, 0.5);
  await ffmpeg([
    "-i", file,
    "-vf", `fps=${rate.toFixed(4)},scale=300:-2,pad=300:ceil(ih/2)*2,tile=${cols}x${rows}:padding=4:color=black`,
    "-frames:v", "1", "-q:v", "5",
    out,
  ]);
}

/** 64-bit difference hash; near-identical photos (burst shots, re-uploads) differ in only a few bits. `at` seeks a video. */
export async function dHash(file: string, tmp: string, at?: number): Promise<bigint> {
  await ffmpeg([...(at !== undefined ? ["-ss", at.toFixed(2)] : []), "-i", file, "-vf", "scale=9:8:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", tmp]);
  const px = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}

export function hamming(a: bigint, b: bigint) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Grid of photo thumbnails (letterboxed to 4:3). */
export async function photoSheet(files: string[], workDir: string, out: string) {
  fs.mkdirSync(workDir, { recursive: true });
  for (let i = 0; i < files.length; i++) {
    await ffmpeg([
      "-i", files[i],
      "-vf", "scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:color=black",
      "-frames:v", "1", "-q:v", "5",
      path.join(workDir, `t_${String(i).padStart(3, "0")}.jpg`),
    ]);
  }
  const cols = Math.min(4, files.length);
  const rows = Math.ceil(files.length / cols);
  await ffmpeg(["-framerate", "1", "-i", path.join(workDir, "t_%03d.jpg"), "-vf", `tile=${cols}x${rows}:padding=4:color=black`, "-frames:v", "1", "-q:v", "5", out]);
}
