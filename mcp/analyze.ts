import fs from "node:fs";
import path from "node:path";
import { downloadFile, listSource, mediaKind, parseSource, type RemoteFile } from "./drive";
import {
  audioEnergy,
  colorOf,
  colorOfFrame,
  contactSheet,
  dHash,
  frameStats,
  hamming,
  imageColor,
  isHdr,
  makeAudioProxy,
  makeImageProxy,
  makeVideoProxy,
  photoSheet,
  probe,
  speechWindows,
  type ColorStat,
  type FrameStat,
} from "./media";
import { detectBeats } from "./beats";
import { isTranscriberAvailable, transcribe } from "./transcribe";
import type { AspectRatio, CaptionCue } from "../shared/plan";

export type { ColorStat } from "./media";

export type ClipInfo = {
  id: string;
  kind: "video";
  name: string;
  folder: string;
  duration: number;
  width: number;
  height: number;
  orientation: "landscape" | "portrait" | "square";
  hasAudio: boolean;
  /** Path of the 1080p proxy, relative to the project directory. */
  proxy: string;
  sheet: string;
  /** Timestamp (s) of each frame in the contact sheet, left-to-right, top-to-bottom. */
  sheetTimes: number[];
  /** Per half-second, 0..1. */
  energy: number[];
  motion: number[];
  /** Per half-second, 0..1: 0 = too dark or smeared (motion blur, shaky pan) to use, 1 = clean. */
  quality?: number[];
  /** Seconds where the footage itself hard-cuts (multi-shot clips, and the joins of a sampled long clip). */
  cuts: number[];
  /** Best few windows by combined score, for Claude's reference. */
  highlights: { start: number; end: number; score: number }[];
  audioLevel: "silent" | "quiet" | "lively" | "loud";
  /** HDR phone footage, tonemapped to SDR in the proxy. */
  hdr?: boolean;
  /** Long clips are proxied as segments spread across the whole recording. */
  sampled?: { sourceDuration: number; segments: { sourceStart: number; proxyStart: number; length: number }[] };
  /** What Claude saw in the contact sheet (saved by propose_themes). */
  notes?: string;
  /** Typical colour of the clip (median of its samples), for matching colour between phones. */
  color?: ColorStat;
  /** The same per half-second, so a shot's grade is based on the moment actually used. */
  colorTrack?: { luma: number[]; u: number[]; v: number[]; sat: number[] };
  /** Where someone is talking, [start, end] seconds. */
  speech?: [number, number][];
  /** Subtitle cues for that speech, when a speech-to-text engine is set up (see transcribe.ts). */
  transcript?: CaptionCue[];
};

export type PhotoInfo = { id: string; kind: "image"; name: string; folder: string; width: number; height: number; proxy: string; notes?: string; color?: ColorStat };
/** bpm/beatOffset come from beat detection, so cuts land on this song's beat. */
export type AudioInfo = { id: string; kind: "audio"; name: string; duration: number; proxy: string; bpm?: number; beatOffset?: number };

export type Analysis = {
  projectId: string;
  source: string;
  occasion: string;
  targetDuration: number;
  suggestedAspect: AspectRatio;
  clips: ClipInfo[];
  photos: PhotoInfo[];
  audio: AudioInfo[];
  photoSheet?: string;
  skipped: { name: string; reason: string }[];
  totals: { footageSeconds: number; files: number };
  createdAt: string;
};

export const LIMITS = { videos: 24, photos: 24, audio: 3 };
const MAX_FILE_BYTES = 2e9;
const MAX_TOTAL_BYTES = 8e9;
/** Clips longer than this are proxied as LONG_CLIP_SEGMENTS evenly spread segments. */
const MAX_CLIP_SECONDS = 120;
const LONG_CLIP_SEGMENTS = 4;

type Progress = (stage: string, fraction: number) => void;

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Groups per-0.25s samples into per-0.5s averages. */
function bucket(stats: FrameStat[], duration: number, value: (s: FrameStat) => number, empty = 0) {
  const n = Math.max(1, Math.ceil(duration / 0.5));
  const sums = new Array(n).fill(0);
  const counts = new Array(n).fill(0);
  for (const s of stats) {
    const i = Math.min(n - 1, Math.floor(s.t / 0.5));
    sums[i] += value(s);
    counts[i]++;
  }
  return sums.map((v, i) => (counts[i] ? v / counts[i] : empty));
}

const ramp = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));

/**
 * Usable-ness per half-second. Brightness is absolute (below ~35/255 is murk). Sharpness is relative
 * to the clip's own median edge density, because a crowd shot and a plain wall differ in detail anyway;
 * a moment much softer than the rest of its clip is motion blur or a shaky pan.
 */
export function qualityOf(stats: FrameStat[], duration: number) {
  const edges = stats.map((s) => s.edges).sort((a, b) => a - b);
  const median = edges[Math.floor(edges.length / 2)] || 1;
  return bucket(stats, duration, (s) => Math.min(ramp(s.luma, 30, 60), ramp(s.edges / median, 0.55, 0.85)), 1);
}

const normalize = (xs: number[]) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return xs.map((x) => (hi - lo < 1e-6 ? 0.5 : (x - lo) / (hi - lo)));
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Picks up to n items spread evenly across sub-folders (round-robin) and across each folder's
 * timeline, so one contributor or one part of the day doesn't dominate.
 */
export function spreadPick<T extends { folder: string }>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const groups = new Map<string, T[]>();
  for (const it of items) groups.set(it.folder, [...(groups.get(it.folder) ?? []), it]);
  const quotas = new Map<string, number>();
  let left = n;
  const keys = [...groups.keys()];
  while (left > 0) {
    let gave = false;
    for (const k of keys) {
      if (left > 0 && (quotas.get(k) ?? 0) < groups.get(k)!.length) {
        quotas.set(k, (quotas.get(k) ?? 0) + 1);
        left--;
        gave = true;
      }
    }
    if (!gave) break;
  }
  const out: T[] = [];
  for (const k of keys) {
    const g = groups.get(k)!;
    const q = quotas.get(k) ?? 0;
    for (let j = 0; j < q; j++) out.push(g[Math.floor(((j + 0.5) * g.length) / q)]);
  }
  return out;
}

async function pool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

function highlightsFor(energy: number[], motion: number[], quality: number[], cuts: number[], duration: number) {
  const win = Math.min(6, Math.max(1, Math.floor(duration / 0.5 / 3)));
  const out: { start: number; end: number; score: number }[] = [];
  for (let i = 0; i + win <= energy.length; i++) {
    const start = i * 0.5;
    const end = start + win * 0.5;
    if (cuts.some((c) => c > start + 0.2 && c < end - 0.2)) continue;
    let s = 0;
    for (let k = i; k < i + win; k++) s += (0.5 * (energy[k] ?? 0) + 0.5 * (motion[k] ?? 0)) * (quality[k] ?? 1);
    out.push({ start, end, score: s / win });
  }
  out.sort((a, b) => b.score - a.score);
  const picked: typeof out = [];
  for (const h of out) {
    if (picked.every((p) => h.end <= p.start || h.start >= p.end)) picked.push({ ...h, score: round2(h.score) });
    if (picked.length === 3) break;
  }
  return picked;
}

/** Everything measured from a clip's proxy (all times in proxy seconds). */
export type ClipMeasures = Pick<ClipInfo, "energy" | "motion" | "quality" | "cuts" | "highlights" | "audioLevel" | "color" | "colorTrack" | "speech" | "transcript">;

/**
 * Watches and listens to a proxy: loudness, motion, usability, internal cuts and best moments; colour from
 * the same frame-stats pass; speech windows from the audio; and subtitles when a transcriber is available.
 */
export async function measureVideoProxy(file: string, duration: number, hasAudio: boolean, sampled?: ClipInfo["sampled"]): Promise<ClipMeasures> {
  const [rms, stats, speech] = await Promise.all([
    hasAudio ? audioEnergy(file) : Promise.resolve([] as number[]),
    frameStats(file),
    hasAudio ? speechWindows(file).catch(() => [] as [number, number][]) : Promise.resolve([] as [number, number][]),
  ]);
  const buckets = Math.max(1, Math.ceil(duration / 0.5));
  const rmsPadded = Array.from({ length: buckets }, (_, k) => rms[k] ?? -90);
  const energy = normalize(rmsPadded.map((db) => Math.max(0, (db + 60) / 60)));
  const motion = normalize(bucket(stats, duration, (s) => s.score));
  const quality = qualityOf(stats, duration);
  const joins = sampled?.segments.slice(1).map((g) => g.proxyStart) ?? [];
  const detected = stats.filter((s) => s.t > 0.3 && s.score > 0.4).map((s) => round2(s.t));
  const cuts = [...new Set([...detected, ...joins])].sort((a, b) => a - b);
  const avgDb = rms.length ? rms.reduce((a, b) => a + b, 0) / rms.length : -90;
  const colors = stats.map((s) => ({ t: s.t, ...colorOfFrame(s) }));
  const track = (k: keyof ColorStat) => bucket(stats, duration, (s) => colorOfFrame(s)[k], NaN).map(round3);
  let transcript: CaptionCue[] | undefined;
  if (speech.length && isTranscriberAvailable()) {
    transcript = await transcribe(file).catch(() => undefined);
  }
  return {
    energy: energy.map(round2),
    motion: motion.map(round2),
    quality: quality.map(round2),
    cuts,
    highlights: highlightsFor(energy, motion, quality, cuts, duration),
    audioLevel: avgDb < -55 ? "silent" : avgDb < -35 ? "quiet" : avgDb < -20 ? "lively" : "loud",
    color: colors.length ? colorOf(colors) : undefined,
    colorTrack: colors.length ? fillGaps({ luma: track("luma"), u: track("u"), v: track("v"), sat: track("sat") }) : undefined,
    speech,
    transcript: transcript?.length ? transcript : undefined,
  };
}

/** Half-seconds with no sample (a stall in the stats) take their neighbour's value, so the JSON stays numeric. */
function fillGaps<T extends Record<string, number[]>>(t: T): T {
  for (const xs of Object.values(t)) {
    for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i])) xs[i] = xs[i - 1] ?? xs.find(Number.isFinite) ?? 0;
  }
  return t;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export async function analyzeSource(opts: {
  projectId: string;
  projectDir: string;
  source: string;
  occasion: string;
  targetDuration: number;
  onProgress: Progress;
}): Promise<Analysis> {
  const { projectDir, onProgress } = opts;
  const dirs = { source: path.join(projectDir, "source"), assets: path.join(projectDir, "assets"), sheets: path.join(projectDir, "sheets") };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

  onProgress("Listing the Drive folder", 0.01);
  const ref = parseSource(opts.source);
  const listed = await listSource(ref);
  const skipped: Analysis["skipped"] = [];
  const byKind = { video: [] as RemoteFile[], image: [] as RemoteFile[], audio: [] as RemoteFile[] };
  const seen = new Set<string>();
  let other = 0;
  for (const f of listed.sort((a, b) => natural.compare(`${a.folder}/${a.name}`, `${b.folder}/${b.name}`))) {
    const kind = f.name ? mediaKind(f.name, f.mimeType) : "video";
    // The same file is often uploaded twice by different people; keep one copy. Only when the size is
    // known: phones reuse names like IMG_0001.MOV, so a shared name alone doesn't make two files the same.
    const dupKey = f.size ? `${f.name.toLowerCase()}|${f.size}` : f.id;
    if (kind === "other") other++;
    else if (!seen.has(dupKey)) {
      seen.add(dupKey);
      byKind[kind].push(f);
    }
  }
  const picked = {
    video: spreadPick(byKind.video, LIMITS.videos),
    image: spreadPick(byKind.image, LIMITS.photos),
    audio: byKind.audio.slice(0, LIMITS.audio),
  };
  for (const k of ["video", "image", "audio"] as const) {
    const left = byKind[k].length - picked[k].length;
    if (left > 0) skipped.push({ name: `${left} more ${k === "image" ? "photo" : k} files`, reason: `sampled ${picked[k].length} evenly across the folder (limit ${LIMITS[k === "image" ? "photos" : k === "video" ? "videos" : "audio"]})` });
  }
  if (other) skipped.push({ name: `${other} other files`, reason: "not a video, photo or audio file" });
  const media = [...picked.video, ...picked.image, ...picked.audio];
  if (!media.length) throw new Error(`No videos, photos or audio found in that folder (${listed.length} files listed).`);

  const clips: ClipInfo[] = [];
  const photos: PhotoInfo[] = [];
  const audio: AudioInfo[] = [];
  let totalBytes = 0;

  let done = 0;
  const tick = (label: string) => onProgress(label, (done / media.length) * 0.95);
  await pool(media, 3, async (f, i) => {
    try {
      tick(`Downloading ${f.name || "file"} (${i + 1}/${media.length})`);
      const dl = await downloadFile(f, dirs.source, MAX_FILE_BYTES);
      totalBytes += dl.bytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        skipped.push({ name: dl.name, reason: "folder is over the 8 GB total limit" });
        fs.rmSync(dl.path, { force: true });
        return;
      }
      const kind = mediaKind(dl.name, f.mimeType);
      const p = await probe(dl.path);

      if (kind === "image") {
        const id = `p${i + 1}`;
        const proxy = `assets/${id}.jpg`;
        await makeImageProxy(dl.path, path.join(projectDir, proxy));
        // One signalstats frame: cheap, and lets photos join the colour match.
        const color = await imageColor(path.join(projectDir, proxy)).catch(() => undefined);
        photos.push({ id, kind: "image", name: dl.name, folder: f.folder, width: p.width, height: p.height, proxy, color });
      } else if (kind === "audio" || (kind === "video" && !p.hasVideo && p.hasAudio)) {
        const id = `a${i + 1}`;
        const proxy = `assets/${id}.m4a`;
        await makeAudioProxy(dl.path, path.join(projectDir, proxy));
        const beats = await detectBeats(path.join(projectDir, proxy)).catch(() => undefined);
        audio.push({ id, kind: "audio", name: dl.name, duration: round2(p.duration), proxy, bpm: beats?.bpm, beatOffset: beats?.offset });
      } else if (p.hasVideo && p.duration >= 0.8) {
        const id = `v${i + 1}`;
        const proxy = `assets/${id}.mp4`;
        tick(`Preparing ${dl.name} (${i + 1}/${media.length})`);
        let sampled: ClipInfo["sampled"];
        if (p.duration > MAX_CLIP_SECONDS) {
          const len = MAX_CLIP_SECONDS / LONG_CLIP_SEGMENTS;
          const segments = Array.from({ length: LONG_CLIP_SEGMENTS }, (_, k) => ({
            sourceStart: round2(Math.max(0, ((k + 0.5) * p.duration) / LONG_CLIP_SEGMENTS - len / 2)),
            proxyStart: k * len,
            length: len,
          }));
          sampled = { sourceDuration: round2(p.duration), segments };
        }
        await makeVideoProxy(dl.path, path.join(projectDir, proxy), {
          hdrTransfer: isHdr(p) ? p.colorTransfer : undefined,
          hasAudio: p.hasAudio,
          segments: sampled?.segments.map((g) => ({ start: g.sourceStart, length: g.length })),
        });
        const pp = await probe(path.join(projectDir, proxy));
        const duration = pp.duration || p.duration;
        tick(`Watching ${dl.name} (${i + 1}/${media.length})`);
        const m = await measureVideoProxy(path.join(projectDir, proxy), duration, pp.hasAudio, sampled);
        const sheet = `sheets/${id}.jpg`;
        await contactSheet(path.join(projectDir, proxy), duration, path.join(projectDir, sheet));
        const orientation = pp.width > pp.height * 1.05 ? "landscape" : pp.height > pp.width * 1.05 ? "portrait" : "square";
        clips.push({
          id,
          kind: "video",
          name: dl.name,
          folder: f.folder,
          duration: round2(duration),
          width: pp.width,
          height: pp.height,
          orientation,
          hasAudio: pp.hasAudio,
          proxy,
          sheet,
          sheetTimes: Array.from({ length: 8 }, (_, k) => round2((k * duration) / 8)),
          ...m,
          hdr: isHdr(p) || undefined,
          sampled,
        });
      } else {
        skipped.push({ name: dl.name, reason: "too short or unreadable" });
      }
      fs.rmSync(dl.path, { force: true });
    } catch (e) {
      skipped.push({ name: f.name || f.id, reason: (e as Error).message.slice(0, 200) });
    } finally {
      done++;
    }
  });
  // Pool workers finish out of order; keep everything in folder/name order with stable ids.
  const order = new Map(media.map((m, i) => [`${i + 1}`, i]));
  const byOrder = (a: { id: string }, b: { id: string }) => (order.get(a.id.slice(1)) ?? 0) - (order.get(b.id.slice(1)) ?? 0);
  clips.sort(byOrder);
  photos.sort(byOrder);
  audio.sort(byOrder);

  // Drop near-duplicate photos (burst shots, the same picture uploaded twice).
  const hashes: bigint[] = [];
  for (let i = 0; i < photos.length; i++) {
    const h = await dHash(path.join(projectDir, photos[i].proxy), path.join(dirs.sheets, "hash.raw"));
    if (hashes.some((o) => hamming(o, h) <= 6)) {
      skipped.push({ name: photos[i].name, reason: "near-duplicate of another photo" });
      photos.splice(i--, 1);
    } else hashes.push(h);
  }

  let photoSheetPath: string | undefined;
  if (photos.length) {
    onProgress("Making the photo overview", 0.96);
    photoSheetPath = "sheets/photos.jpg";
    await photoSheet(photos.slice(0, 16).map((p) => path.join(projectDir, p.proxy)), path.join(dirs.sheets, "thumbs"), path.join(projectDir, photoSheetPath));
  }
  if (!clips.length && !photos.length) throw new Error(`Nothing usable in the folder. Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);

  const portrait = clips.filter((c) => c.orientation === "portrait").length + photos.filter((p) => p.height > p.width).length;
  const landscape = clips.filter((c) => c.orientation === "landscape").length + photos.filter((p) => p.width > p.height).length;

  const analysis: Analysis = {
    projectId: opts.projectId,
    source: opts.source,
    occasion: opts.occasion,
    targetDuration: opts.targetDuration,
    suggestedAspect: portrait > landscape ? "9:16" : "16:9",
    clips,
    photos,
    audio,
    photoSheet: photoSheetPath,
    skipped,
    totals: { footageSeconds: round2(clips.reduce((n, c) => n + c.duration, 0)), files: media.length },
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(projectDir, "analysis.json"), JSON.stringify(analysis, null, 2));
  onProgress("Done", 1);
  return analysis;
}
