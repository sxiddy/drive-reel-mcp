import { spawn } from "node:child_process";
import fs from "node:fs";
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
};

export const isHdr = (p: Pick<Probe, "colorTransfer">) => p.colorTransfer === "arib-std-b67" || p.colorTransfer === "smpte2084";

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type: string; codec_name?: string; color_transfer?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
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
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
  const segs = opts.segments ?? [];
  if (segs.length <= 1) {
    const cut = segs[0] ? ["-ss", String(segs[0].start), "-t", String(segs[0].length)] : [];
    await ffmpeg([...cut, "-i", src, "-vf", vf, "-ac", "2", "-ar", "48000", ...enc]);
    return;
  }
  const inputs = segs.flatMap((g) => ["-ss", String(g.start), "-t", String(g.length), "-i", src]);
  const graph = segs.map((_, i) => `[${i}:v]${vf}[v${i}]` + (opts.hasAudio ? `;[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]` : "")).join(";");
  const join = segs.map((_, i) => `[v${i}]` + (opts.hasAudio ? `[a${i}]` : "")).join("");
  const concat = `${join}concat=n=${segs.length}:v=1:a=${opts.hasAudio ? 1 : 0}[v]${opts.hasAudio ? "[a]" : ""}`;
  await ffmpeg([...inputs, "-filter_complex", `${graph};${concat}`, "-map", "[v]", ...(opts.hasAudio ? ["-map", "[a]"] : []), ...enc]);
}

export async function makeImageProxy(src: string, out: string) {
  await ffmpeg(["-i", src, "-vf", "scale='min(2160,iw)':-2", "-frames:v", "1", "-q:v", "3", out]);
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

export type FrameStat = { t: number; score: number; luma: number; edges: number };

/**
 * One pass, 4 samples a second: scene-change score (0 = static, 1 = hard cut), average brightness
 * (0–255) and edge density (how much fine detail survives; motion blur and shaky pans drop it),
 * so the planner can avoid dark or smeared moments.
 */
export async function frameStats(file: string): Promise<FrameStat[]> {
  const { stderr } = await ffmpeg([
    "-i", file, "-an",
    "-vf",
    "fps=4,scale=640:-2,select='gte(scene,0)',signalstats,metadata=print," +
      "format=gray,edgedetect=low=0.08:high=0.2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f", "null", "-",
  ]);
  // Each frame is printed twice: first scene score + brightness, then the edge map's average.
  const byTime = new Map<string, FrameStat & { seen: number }>();
  let cur: (FrameStat & { seen: number }) | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) {
      cur = byTime.get(t[1]);
      if (!cur) byTime.set(t[1], (cur = { t: Number(t[1]), score: 0, luma: 128, edges: 0, seen: 0 }));
      cur.seen++;
      continue;
    }
    const kv = cur && line.match(/lavfi\.(scene_score|signalstats\.YAVG)=([\d.]+)/);
    if (!cur || !kv) continue;
    if (kv[1] === "scene_score") cur.score = Number(kv[2]);
    else if (cur.seen === 1) cur.luma = Number(kv[2]);
    else cur.edges = Number(kv[2]);
  }
  return [...byTime.values()].map(({ seen: _seen, ...rest }) => rest).sort((x, y) => x.t - y.t);
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

/** 64-bit difference hash; near-identical photos (burst shots, re-uploads) differ in only a few bits. */
export async function dHash(file: string, tmp: string): Promise<bigint> {
  await ffmpeg(["-i", file, "-vf", "scale=9:8:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", tmp]);
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
