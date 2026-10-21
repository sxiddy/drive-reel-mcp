import { z } from "zod";
import { AspectRatio, EditPlan, type CaptionCue, type Grade, type Scene } from "../shared/plan";
import { STYLES, STYLE_IDS, type StyleDef } from "../shared/styles";
import { musicFor } from "../shared/occasions";
import type { Analysis, ClipInfo, ColorStat, PhotoInfo } from "./analyze";
import { captureClock, dateRangeLabel, timeChips, timeOrder } from "./capture";
import type { FaceSample } from "./faces";
import { loadLibrary, pickTrack, trackSegment, type LibraryTrack } from "./library";

/** What Claude proposes for each theme. Validated by the propose_themes tool. */
export const ThemeInput = z.object({
  name: z.string().min(2).max(60).describe("Short catchy theme name, e.g. 'Midnight Code Rush'"),
  pitch: z
    .string()
    .min(10)
    .max(300)
    .describe("One or two sentences the user reads to choose. Name what is actually in the footage (e.g. 'opens on the empty hall at dawn, peaks on the prize reveal'), not generic adjectives"),
  story: z.string().min(10).max(200).describe("The arc of this cut in one line: how it opens, where it peaks, how it closes. Each theme should tell a different story"),
  occasionFit: z.string().min(10).max(200).describe("Why this theme suits the occasion, e.g. 'A wedding film: slow, warm, ends on the first dance'"),
  styleId: z.enum(STYLE_IDS).describe("Visual style preset this theme builds on"),
  title: z.string().min(1).max(60).describe("Big title shown in the intro"),
  subtitle: z.string().max(100).optional().describe("Line under the title, e.g. date and venue"),
  outroText: z.string().max(60).describe("Closing line, e.g. 'See you next year'"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Optional accent colour override (hex)"),
  aspect: AspectRatio.optional().describe("Override the frame; defaults to the footage's dominant orientation"),
  music: z
    .enum(["drive", "library", "generated", "none"])
    .optional()
    .describe("'drive' uses an audio file from the folder; 'library' (or 'generated') picks a royalty-free track matching the style. Defaults to drive if present"),
  shots: z
    .array(
      z.object({
        id: z.string().describe("Clip id (v…) or photo id (p…) from the analysis"),
        start: z.number().min(0).optional().describe("For clips: start second, read off the contact sheet timestamps; omit to let the planner pick the best moment"),
        caption: z.string().max(80).optional().describe("Optional on-screen caption for this shot"),
      }),
    )
    .min(3)
    .max(80)
    .describe(
      "Your ordered shot list, chosen from the contact sheets: at least the opening shot, the peak moment and the closing shot (3+). The planner keeps your order and fills the gaps between them with the best remaining moments",
    ),
});
export type ThemeInput = z.infer<typeof ThemeInput>;
export type Theme = ThemeInput & { id: string };

/** clean: quality × sharpness × stamp alone (0..1), without the style's energy/motion preference. */
type Window = { clip: ClipInfo; start: number; len: number; score: number; clean: number };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clampTo = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------------------------------------
// Colour match
// ---------------------------------------------------------------------------------------------------------

/**
 * How far each shot is pulled toward the folder's typical colour (1 = all the way) and the hard limits.
 * Partial pulls on purpose: a night shot should stay darker than a noon one, and a mean colour can be
 * content (a green forest) as much as cast, so cast removal is gentle and capped. Bright shots are pulled
 * down less than dim ones are lifted: snow, sand and sky are bright by nature, and darkening them reads as grey.
 */
export const GRADE_LIMITS = { lift: 0.7, lower: 0.4, cast: 0.6, saturation: 0.6, gamma: [0.75, 1.2], maxGain: 1.1, saturationRange: [0.8, 1.25] } as const;

const LUMA_W = [0.2126, 0.7152, 0.0722] as const;
/** Rec.709 Y'CbCr (Y 0..1, chroma ±0.5) to R'G'B'. */
const rgbOf = (c: Pick<ColorStat, "luma" | "u" | "v">) => [c.luma + 1.5748 * c.v, c.luma - 0.1873 * c.u - 0.4681 * c.v, c.luma + 1.8556 * c.u];

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The folder's typical colour: per-channel median over every clip and photo that was measured. */
export function folderColor(analysis: Pick<Analysis, "clips" | "photos">): ColorStat | undefined {
  const cs = [...analysis.clips.map((c) => c.color), ...analysis.photos.map((p) => p.color)].filter((c): c is ColorStat => !!c);
  if (cs.length < 2) return undefined;
  return { luma: medianOf(cs.map((c) => c.luma)), u: medianOf(cs.map((c) => c.u)), v: medianOf(cs.map((c) => c.v)), sat: medianOf(cs.map((c) => c.sat)) };
}

/** Colour of the part of a clip a shot uses (from the per-half-second track), else the clip's own. */
export function windowColor(clip: ClipInfo, start: number, len: number): ColorStat | undefined {
  const t = clip.colorTrack;
  if (!t?.luma.length) return clip.color;
  const a = Math.max(0, Math.floor(start / 0.5));
  const b = Math.min(t.luma.length, Math.max(a + 1, Math.ceil((start + len) / 0.5)));
  const idx = Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k).filter((i) => t.luma[i] > 0.06);
  if (!idx.length) return clip.color;
  const mean = (xs: number[]) => idx.reduce((n, i) => n + xs[i], 0) / idx.length;
  return { luma: mean(t.luma), u: mean(t.u), v: mean(t.v), sat: mean(t.sat) };
}

/**
 * Correction that pulls a shot of colour `c` part of the way toward `target` (see Grade in shared/plan):
 * white-balance gains from the shift in mean chroma, normalised so the smallest gain is 1 (whites stay
 * white); then an exposure gamma that moves the mean luma (gamma keeps black and white points, so nothing
 * is crushed or blown out the way a straight gain would); then saturation, allowing for the chroma the
 * gamma itself adds or removes. Returns undefined when the shot already matches.
 */
export function gradeToward(c: ColorStat, target: ColorStat, L = GRADE_LIMITS): Grade | undefined {
  const m = rgbOf(c);
  const want = rgbOf({ luma: c.luma, u: c.u + L.cast * (target.u - c.u), v: c.v + L.cast * (target.v - c.v) });
  let gain = m.map((x, i) => (x > 0.03 && want[i] > 0.03 ? want[i] / x : 1));
  const lo = Math.min(...gain);
  gain = gain.map((g) => clampTo(g / lo, 1, L.maxGain));
  const lit = clampTo(gain.reduce((n, g, i) => n + LUMA_W[i] * Math.min(1, g * m[i]), 0), 0.03, 0.97);
  const aim = clampTo(c.luma + (target.luma > c.luma ? L.lift : L.lower) * (target.luma - c.luma), 0.03, 0.97);
  const gamma = clampTo(Math.log(aim) / Math.log(lit), L.gamma[0], L.gamma[1]);
  // d(x^γ)/dx = γ·x^(γ−1): the gamma scales chroma near the mean luma by about that much.
  const satAfter = c.sat * gamma * Math.pow(lit, gamma - 1);
  const satAim = c.sat + L.saturation * (target.sat - c.sat);
  const saturation = satAfter > 0.004 ? clampTo(satAim / satAfter, L.saturationRange[0], L.saturationRange[1]) : 1;
  const g: Grade = { gain: [r3(gain[0]), r3(gain[1]), r3(gain[2])], gamma: r3(gamma), saturation: r3(saturation) };
  const trivial = g.gain.every((x) => Math.abs(x - 1) < 0.01) && Math.abs(g.gamma - 1) < 0.02 && Math.abs(g.saturation - 1) < 0.02;
  return trivial ? undefined : g;
}

// ---------------------------------------------------------------------------------------------------------
// Speech-aware cuts
// ---------------------------------------------------------------------------------------------------------

/** How deep inside a phrase a cut at `t` lands: 0 in a pause, else the shorter side of the phrase, in seconds. */
export function chopAt(t: number, speech: readonly (readonly [number, number])[] | undefined) {
  for (const [a, b] of speech ?? []) if (a < t && t < b) return Math.min(t - a, b - t);
  return 0;
}

/** Phrase lost at both ends of a shot `[start, start + len]`. */
export const chopOf = (clip: Pick<ClipInfo, "speech">, start: number, len: number) => chopAt(start, clip.speech) + chopAt(start + len, clip.speech);

/**
 * How far (s) a shot may slide inside its clip to dodge a phrase. Less when Claude chose the moment, though
 * those starts are read off 8-frame contact sheets, so a second or so either way is within their precision.
 */
const SLIDE = { chosen: 1.25, auto: 2 };

/**
 * Files whose names say text is burned into the picture (GPS/timestamp camera apps, screenshots and screen
 * recordings). They still count, but only after every clean shot: a map stamp in an aftermovie looks broken.
 */
export const STAMPED = /gps ?map ?camera|bygpsmap|timestamp ?cam|notecam|screenshot|screen ?record|screencast/i;
export const stampFactor = (name: string) => (STAMPED.test(name) ? 0.3 : 1);

// ---------------------------------------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------------------------------------

/** The clip's face sample nearest to second `t`, if faces were measured. */
export function faceAt(clip: Pick<ClipInfo, "faces">, t: number): FaceSample | undefined {
  const fs = clip.faces;
  if (!fs?.length) return undefined;
  return fs.reduce((best, s) => (Math.abs((s.t ?? 0) - t) < Math.abs((best.t ?? 0) - t) ? s : best));
}

/**
 * Score multiplier from faces: people (and close faces) are what an event video is about; no face at all
 * is a bare wall, a ceiling, a display case or an empty corridor. 1 when faces weren't measured.
 */
export function faceFactor(s: Pick<FaceSample, "n" | "area"> | undefined): number {
  if (!s) return 1;
  if (!s.n) return 0.55;
  return 1 + 0.25 * Math.min(1, s.n / 4) + 0.5 * Math.min(1, s.area / 0.04);
}

/** Crop focus (the faces' centre) when the faces are big enough to matter for framing. */
export function focusOf(s: FaceSample | undefined): [number, number] | undefined {
  if (!s?.n || s.area < 0.0015) return undefined;
  return [r3(clampTo(s.cx, 0, 1)), r3(clampTo(s.cy, 0, 1))];
}

/**
 * Establishing-shot score: a wide, sharp, landscape view with no close faces (the hall, the venue).
 * Group-shot score: as many faces as possible, the more the better (the closing photo).
 */
export function establishingScore(o: { detail: number; detailRef: number; faces?: Pick<FaceSample, "n" | "area">; landscape: boolean; clean: number }) {
  const sharp = o.detailRef > 0 ? clampTo(o.detail / o.detailRef, 0, 2) : 1;
  const wide = o.faces ? (o.faces.area < 0.004 ? 1 : o.faces.area < 0.015 ? 0.6 : 0.25) : 0.7;
  return sharp * wide * (o.landscape ? 1 : 0.55) * o.clean;
}
export const groupScore = (faces: Pick<FaceSample, "n" | "area"> | undefined, quality: number) => (faces?.n ?? 0) * (0.5 + 0.5 * quality);

/**
 * Scores every possible shot of length `len` in a clip. Shots that span a hard cut inside the clip are
 * skipped, and moments the analysis marked as dark or smeared (motion blur, shaky pans) score lower.
 */
export function windowsFor(clip: ClipInfo, len: number, style: StyleDef, detailRef = 0): Window[] {
  const out: Window[] = [];
  const usable = clip.duration - 0.15;
  if (usable < len) {
    // Clip shorter than a shot: use all of it.
    return [{ clip, start: 0, len: Math.max(0.5, usable), score: 0.3 * stampFactor(clip.name), clean: stampFactor(clip.name) }];
  }
  const w = style.prefer === "energy" ? { e: 0.5, m: 0.5, s: 0 } : style.prefer === "calm" ? { e: 0.25, m: 0.05, s: 0.7 } : { e: 0.35, m: 0.35, s: 0.3 };
  for (let start = clip.duration > len + 0.6 ? 0.3 : 0; start + len <= usable; start += 0.5) {
    if ((clip.cuts ?? []).some((c) => c > start + 0.15 && c < start + len - 0.15)) continue;
    const a = Math.floor(start / 0.5);
    const b = Math.max(a + 1, Math.ceil((start + len) / 0.5));
    let e = 0;
    let m = 0;
    let q = 0;
    let k = 0;
    let d = 0;
    let dn = 0;
    for (let i = a; i < b && i < clip.energy.length; i++, k++) {
      const di = clip.detail?.[i];
      if (di !== undefined && Number.isFinite(di)) (d += di), dn++;
      e += clip.energy[i] ?? 0;
      m += clip.motion[i] ?? 0;
      q += clip.quality?.[i] ?? 1;
    }
    e /= Math.max(1, k);
    m /= Math.max(1, k);
    q /= Math.max(1, k);
    // A shot that opens or closes mid-sentence sounds broken; the final trim is refined later, this just steers the pick.
    // Much less detail than the folder's typical shot: a blurred camera swing, a ceiling, a bare wall.
    const sharp = detailRef > 0 && dn ? 0.15 + 0.85 * Math.max(0, Math.min(1, (d / dn / detailRef - 0.25) / 0.35)) : 1;
    const talk = clip.speech?.length ? 1 - Math.min(0.6, 0.6 * chopOf(clip, start, len)) : 1;
    const clean = (0.25 + 0.75 * q) * sharp * stampFactor(clip.name);
    const people = faceFactor(faceAt(clip, start + len / 2));
    out.push({ clip, start, len, score: (w.e * e + w.m * m + w.s * (1 - m)) * clean * talk * people, clean });
  }
  return out;
}

const overlaps = (a: { start: number; len: number }, b: { start: number; len: number }, gap = 0.4) =>
  a.start < b.start + b.len + gap && b.start < a.start + a.len + gap;

/** The folder's typical edge density (median over every measured half-second): the sharpness reference. */
export function detailRefOf(clips: Pick<ClipInfo, "detail">[]): number {
  const all = clips.flatMap((c) => (c.detail ?? []).filter((x): x is number => typeof x === "number" && Number.isFinite(x))).sort((x, y) => x - y);
  return all[Math.floor(all.length / 2)] ?? 0;
}

/**
 * A window's "cleanliness" (quality × sharpness × stamp, 0..1) below this means a blurred swing, a ceiling,
 * a dark corner or a stamped file. Such windows are used only when nothing else is left.
 */
export const CLEAN_MIN = 0.35;

/** Best window of a clip for a style, preferring clean ones; undefined if the clip has no window at all. */
export function bestWindow(clip: ClipInfo, len: number, style: StyleDef, detailRef: number, avoid: { start: number; len: number }[] = []): Window | undefined {
  const wins = windowsFor(clip, len, style, detailRef)
    .filter((w) => avoid.every((t) => !overlaps(t, w)))
    .sort((a, b) => Number(b.clean >= CLEAN_MIN) - Number(a.clean >= CLEAN_MIN) || b.score - a.score);
  return wins[0];
}

// ---------------------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------------------

/** The folder's typical photo detail (median), else the clips' reference. */
export function photoDetailRef(photos: Pick<PhotoInfo, "detail">[], clipRef = 0): number {
  const ds = photos.map((p) => p.detail).filter((x): x is number => typeof x === "number" && x > 0);
  return ds.length >= 3 ? medianOf(ds) : clipRef;
}

/**
 * How usable a photo is, 0..1, before the stamp penalty: exposure (mean luma; a dim party photo is fine, a
 * black frame isn't) × sharpness relative to the folder's photos (a shaken or out-of-focus shot has far
 * less edge detail). Photos without measurements count as fine.
 */
export function photoQuality(p: Pick<PhotoInfo, "luma" | "detail" | "color">, ref: number): number {
  const luma = p.luma ?? p.color?.luma;
  const exposure = luma === undefined ? 1 : 0.1 + 0.9 * clampTo((luma - 0.05) / 0.15, 0, 1);
  const sharp = p.detail === undefined || ref <= 0 ? 1 : 0.1 + 0.9 * clampTo((p.detail / ref - 0.2) / 0.4, 0, 1);
  return exposure * sharp;
}
/** Photos under this quality are never used. */
export const PHOTO_MIN = 0.35;

// ---------------------------------------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------------------------------------

/**
 * Reorders `items` so no two neighbours share a key wherever that's possible (two shots of the same clip
 * back to back read as one long shot with a jump cut). Items are moved one at a time to break each repeat.
 * `pinned` positions never change; `anchor` items keep their order relative to each other.
 */
export function spreadApart<T>(input: readonly T[], key: (t: T) => string, opts: { anchor?: (t: T) => boolean; pinned?: (i: number) => boolean } = {}): T[] {
  const a = [...input];
  const n = a.length;
  const anchor = opts.anchor ?? (() => false);
  const pinned = opts.pinned ?? (() => false);
  const k = (i: number) => (i >= 0 && i < a.length ? key(a[i]) : undefined);
  const anchorsIn = (lo: number, hi: number) => a.slice(Math.max(0, lo), Math.max(0, hi + 1)).some(anchor);
  for (let i = 1; i < n; i++) {
    if (k(i) !== k(i - 1)) continue;
    const fits = (j: number) => {
      const c = key(a[j]);
      return !pinned(j) && c !== k(i - 1) && c !== k(i) && k(j - 1) !== k(j + 1);
    };
    let moved = false;
    // Pull a later item forward into the gap…
    for (let j = i + 1; j < n && !moved; j++) {
      if (!fits(j) || (anchor(a[j]) && anchorsIn(i, j - 1))) continue;
      a.splice(i, 0, a.splice(j, 1)[0]);
      moved = true;
    }
    // …or push an earlier one back into it.
    for (let j = i - 2; j >= 0 && !moved; j--) {
      if (!fits(j) || (anchor(a[j]) && anchorsIn(j + 1, i - 1))) continue;
      a.splice(i - 1, 0, a.splice(j, 1)[0]);
      moved = true;
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------------------------------------

/** Typical RMS level (dBFS) of each audioLevel class, for analyses made before per-clip levels were stored. */
const LEVEL_DB = { silent: -60, quiet: -40, lively: -27, loud: -16 } as const;
/** Clip gain is evened out by at most this much either way (dB). */
export const LOUDNESS_RANGE_DB = 9;
/** Shots quieter than this are near-silence: boosting them only lifts hiss. */
const QUIET_DB = -50;

/** RMS level (dBFS) of the part of a clip a shot plays: the power mean of its half-second levels. */
export function shotLevel(clip: Pick<ClipInfo, "levels" | "audioLevel" | "hasAudio">, start: number, len: number): number {
  if (!clip.hasAudio) return -90;
  const L = clip.levels;
  if (!L?.length) return LEVEL_DB[clip.audioLevel] ?? -27;
  const a = clampTo(Math.floor(start / 0.5), 0, L.length - 1);
  const b = clampTo(Math.ceil((start + len) / 0.5), a + 1, L.length);
  let p = 0;
  for (let i = a; i < b; i++) p += 10 ** ((L[i] ?? -90) / 10);
  return 10 * Math.log10(p / (b - a) + 1e-12);
}

/** Gain (dB) that brings a shot at `level` toward `ref`, within ±LOUDNESS_RANGE_DB. Near-silent shots are left alone. */
export const levelGainDb = (level: number, ref: number) => (level < QUIET_DB ? 0 : clampTo(ref - level, -LOUDNESS_RANGE_DB, LOUDNESS_RANGE_DB));

export type BuildResult = {
  plan: EditPlan;
  musicNeeded:
    | { kind: "generated"; seconds: number }
    | { kind: "drive"; src: string }
    /** Cut `seconds` of the library track starting at `start` into plan.music.src. */
    | { kind: "library"; path: string; start: number; seconds: number }
    | null;
  notes: string[];
};

/** Styles whose title sits over the opening shot (with letterbox bars) instead of on its own card. */
/** A song the cut is taken from (library track or the visitor's own). */
type CutTrack = { path: string; bpm: number; beatOffset: number; dropAt?: number; duration: number; credit: string };

export const OPENING_TITLE_STYLES = ["cinematic", "hype", "neon"] as const;

/** Seconds of speech and subtitles kept either side of a shot, so trimming it in the editor keeps them. */
const SPEECH_MARGIN = 3;

/** Extra soundtrack beyond the target, so lengthening the video in the editor doesn't run out of music. */
const MUSIC_HEADROOM = 20;

export function buildPlan(analysis: Analysis, theme: Theme, opts: { durationOverride?: number; library?: LibraryTrack[] } = {}): BuildResult {
  const style = STYLES[theme.styleId];
  const notes: string[] = [];
  const target = Math.max(8, Math.min(300, opts.durationOverride ?? analysis.targetDuration));
  const aspect = theme.aspect ?? analysis.suggestedAspect;
  const fps = 30 as const;
  const energetic = style.prefer === "energy";

  const musicMode = theme.music ?? (analysis.audio.length ? "drive" : "library");
  // A song uploaded on the website (id a0) beats audio files found in the folder; else the longest file.
  const driveTrack = musicMode === "drive" ? (analysis.audio.find((a) => a.id === "a0") ?? [...analysis.audio].sort((a, b) => b.duration - a.duration)[0]) : undefined;
  // Without a Drive song: a royalty-free library track picked for the style (the same one for the same
  // project and theme); the synthesised soundtrack only when the library is empty.
  const libTrack = musicMode !== "none" && !driveTrack ? pickTrack(theme.styleId, analysis.occasion, target, `${analysis.projectId}|${theme.id}`, opts.library ?? loadLibrary()) : undefined;
  if (musicMode === "drive" && !driveTrack) notes.push(libTrack ? `No audio file in the folder, so "${libTrack.title}" from the music library was used.` : "No audio file in the folder, so a matching track was generated.");
  const useGenerated = musicMode !== "none" && !driveTrack && !libTrack;
  // The visitor's own song with a detected drop: cut like a library track, so its drop lands on the peak too.
  const ownCut =
    driveTrack?.bpm && driveTrack.dropAt !== undefined && energetic
      ? { path: driveTrack.proxy, bpm: driveTrack.bpm, beatOffset: driveTrack.beatOffset ?? 0, dropAt: driveTrack.dropAt, duration: driveTrack.duration, credit: driveTrack.name }
      : undefined;
  const cutTrack: CutTrack | undefined = libTrack ?? ownCut;

  // The beat grid: the song's tempo and first beat (Drive songs are beat-detected, library tracks carry
  // theirs), or the generated track's (beat one at 0).
  const music = musicFor(style, analysis.occasion);
  const bpm = driveTrack?.bpm ?? libTrack?.bpm ?? music.bpm;
  if (driveTrack && !driveTrack.bpm) notes.push(`Couldn't detect the tempo of "${driveTrack.name}", so cuts follow the style's ${bpm} BPM.`);
  const musicBeat = 60 / bpm;
  // Library track: which part of it plays. Energy styles with a drop are aligned later so the drop lands on
  // the peak; otherwise the segment trackSegment picks (starting on a bar).
  const dropAligned = !!cutTrack && energetic && cutTrack.dropAt !== undefined;
  // Either way the cut file starts exactly on a beat, so the grid's phase is 0.
  const mod = (x: number, m: number) => ((x % m) + m) % m;
  let musicStart = 0;
  if (libTrack && !dropAligned) {
    const seg = trackSegment(libTrack, target, theme.styleId).start;
    musicStart = seg + mod(libTrack.beatOffset - seg, musicBeat);
  }
  const phase = driveTrack?.bpm && !ownCut ? (driveTrack.beatOffset ?? 0) : 0;
  // Energy styles cut on half beats (bursts at the drop are one half-beat long); calm ones on full beats.
  const beat = energetic ? musicBeat / 2 : musicBeat;
  let openingTitle = (OPENING_TITLE_STYLES as readonly string[]).includes(style.id) && (analysis.clips.length > 0 || analysis.photos.length > 0);

  const shotBeats = Math.max(2, Math.round(style.shotLength / beat));
  const shot = shotBeats * beat; // cut-to-cut
  const td = style.transition.type === "none" ? 0 : Math.min(style.transition.duration, beat * 0.9, shot / 3);
  // No shot holds longer than about twice the style's shot length: a long static shot drags. Shots are
  // first planned to fit at up to 1.5× (adding shots if needed), and only then stretched toward the cap.
  const capBeats = Math.max(shotBeats, Math.round((2 * style.shotLength) / beat));
  const comfyBeats = Math.max(shotBeats, Math.min(capBeats, Math.round((1.5 * style.shotLength) / beat)));
  // Title and end card stay short: in a 15 s cut every second of card is a shot lost.
  const introBeats = target < 20 ? Math.max(1, Math.round(1.2 / beat)) : Math.max(Math.ceil(1.6 / beat), Math.min(Math.floor(2.6 / beat), Math.round((target * 0.05) / beat)));
  const outroNominal = target < 20 ? 1 : 1.8;
  const body = target - introBeats * beat - phase - outroNominal;
  const nAuto = Math.max(1, Math.round(body / shot));
  const wantBeats = Math.round((target - outroNominal - phase) / beat) - introBeats;

  // A clip must hold at least one beat plus the transition, or its scene would run out of footage.
  const minClip = musicBeat + td + 0.15;
  const tooShort = analysis.clips.filter((c) => c.duration < minClip);
  if (tooShort.length) notes.push(`Skipped ${tooShort.length} clip${tooShort.length === 1 ? "" : "s"} shorter than one beat (${minClip.toFixed(1)}s).`);
  const clips = analysis.clips.filter((c) => c.duration >= minClip);
  const detailRef = detailRefOf(clips);
  const photoRef = photoDetailRef(analysis.photos, detailRef);
  // Dark or blurry photos are dropped; the rest are ranked by quality (stamped files last).
  const photoRank = (p: PhotoInfo) => photoQuality(p, photoRef) * stampFactor(p.name) * faceFactor(p.faces);
  const blurry = analysis.photos.filter((p) => photoQuality(p, photoRef) < PHOTO_MIN);
  if (blurry.length) notes.push(`Left out ${blurry.length} photo${blurry.length === 1 ? "" : "s"} that ${blurry.length === 1 ? "is" : "are"} too dark or blurry.`);
  const photos = analysis.photos.filter((p) => photoQuality(p, photoRef) >= PHOTO_MIN);

  // Photos get a share of the timeline proportional to how much of the folder they are, capped at 40%.
  const photoShare = clips.length ? Math.min(0.4, photos.length / (photos.length + clips.length * 2)) : 1;
  const nPhotos = photos.length ? Math.max(clips.length ? 0 : 1, Math.round(nAuto * photoShare)) : 0;
  const nClips = clips.length ? nAuto - nPhotos : 0;

  type Pick = { kind: "video"; clip: ClipInfo; start: number; len: number; caption?: string; chosen?: boolean } | { kind: "image"; photo: PhotoInfo; caption?: string };
  const picks: Pick[] = [];
  // A clip plays for its whole sequence, including the transition overlap.
  const seqLen = shot + td;
  const used = new Map<string, { start: number; len: number }[]>();
  const take = (clip: ClipInfo, w: { start: number; len: number }) => used.set(clip.id, [...(used.get(clip.id) ?? []), w]);
  const usedPhotos = new Set<string>();

  // 1) Claude's curated shots, in its order. A repeat of a clip gets a different, non-overlapping moment.
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const photoById = new Map(analysis.photos.map((p) => [p.id, p]));
  const curated = theme.shots ?? [];
  for (const s of curated) {
    const clip = clipById.get(s.id);
    const photo = photoById.get(s.id);
    if (clip) {
      const len = Math.min(seqLen, Math.max(0.5, clip.duration - 0.15));
      const taken = used.get(clip.id) ?? [];
      let start = s.start;
      if (start !== undefined) start = Math.max(0, Math.min(start, clip.duration - len - 0.05));
      if (start === undefined || taken.some((t) => overlaps(t, { start: start!, len }))) {
        const want = start;
        const free = windowsFor(clip, len, style, detailRef).filter((w) => taken.every((t) => !overlaps(t, w)));
        const best =
          want === undefined
            ? bestWindow(clip, len, style, detailRef, taken)
            : free.sort((a, b) => Math.abs(a.start - want) - Math.abs(b.start - want))[0];
        if (!best) {
          notes.push(`Dropped a repeat of ${clip.name}: no footage left that the edit doesn't already use.`);
          continue;
        }
        start = best.start;
      }
      take(clip, { start, len });
      picks.push({ kind: "video", clip, start, len, caption: s.caption, chosen: s.start !== undefined });
    } else if (photo) {
      if (usedPhotos.has(photo.id)) continue;
      usedPhotos.add(photo.id);
      picks.push({ kind: "image", photo, caption: s.caption });
    } else if (analysis.clips.some((c) => c.id === s.id)) continue;
    else notes.push(`Ignored unknown shot id "${s.id}".`);
  }

  // 2) The best remaining moments, round-robin across clips so the folder is well covered. Clean windows
  //    first; blurred, dark or stamped ones only once everything else (photos included) is used up.
  const pools = clips
    .map((c) => {
      const wins = windowsFor(c, seqLen, style, detailRef).sort((a, b) => b.score - a.score);
      return { clip: c, clean: wins.filter((w) => w.clean >= CLEAN_MIN), rest: wins.filter((w) => w.clean < CLEAN_MIN) };
    })
    .sort((a, b) => (b.clean[0]?.score ?? 0) - (a.clean[0]?.score ?? 0));
  let cursor = 0;
  const nextClip = (tier: "clean" | "rest"): Pick | undefined => {
    for (let tries = 0; tries < pools.length; tries++) {
      const pool = pools[cursor++ % pools.length];
      const taken = used.get(pool.clip.id) ?? [];
      const w = pool[tier].find((x) => taken.every((t) => !overlaps(t, x)));
      if (!w) continue;
      take(pool.clip, w);
      return { kind: "video", clip: pool.clip, start: w.start, len: w.len };
    }
    return undefined;
  };
  const photoQueue = photos.filter((p) => !usedPhotos.has(p.id)).sort((a, b) => photoRank(b) - photoRank(a));
  const nextPhoto = (): Pick | undefined => {
    const p = photoQueue.shift();
    return p && { kind: "image", photo: p };
  };
  const auto: Pick[] = [];
  for (let n = picks.filter((p) => p.kind === "video").length; n < nClips; n++) {
    const p = nextClip("clean");
    if (!p) break;
    auto.push(p);
  }
  for (let n = picks.filter((p) => p.kind === "image").length; n < nPhotos; n++) {
    const p = nextPhoto();
    if (!p) break;
    auto.push(p);
  }

  // Each clip shot owns a stretch of its clip, split halfway to the neighbouring shots of the same clip:
  // stretching a shot to fit the beat grid never replays footage another shot shows.
  const rooms = new Map<Pick, { lo: number; hi: number }>();
  const computeRooms = (all: Pick[]) => {
    rooms.clear();
    const byClip = new Map<string, Extract<Pick, { kind: "video" }>[]>();
    for (const p of all) if (p.kind === "video") byClip.set(p.clip.id, [...(byClip.get(p.clip.id) ?? []), p]);
    for (const list of byClip.values()) {
      list.sort((a, b) => a.start - b.start);
      list.forEach((p, k) => {
        const prev = list[k - 1];
        const next = list[k + 1];
        const lo = prev ? Math.min(p.start, (prev.start + prev.len + p.start) / 2) : 0;
        const hi = next ? Math.max(p.start + p.len, (p.start + p.len + next.start) / 2) : p.clip.duration;
        rooms.set(p, { lo, hi: Math.min(hi, p.clip.duration - 0.05) });
      });
    }
  };
  const maxBeatsOf = (p: Pick) => {
    if (p.kind === "image") return capBeats;
    const r = rooms.get(p)!;
    return Math.max(1, Math.min(capBeats, Math.floor((r.hi - r.lo - 0.1 - td) / beat)));
  };

  // 3) Not enough footage for the length at a comfortable pace: add more shots (other clips' moments, then
  //    unused photos, then the weaker windows) rather than holding any shot too long. If the folder runs
  //    dry the video comes out a little shorter instead.
  for (let guard = 0; guard < 200; guard++) {
    const all = [...picks, ...auto];
    computeRooms(all);
    if (all.reduce((n, p) => n + Math.min(comfyBeats, maxBeatsOf(p)), 0) >= wantBeats) break;
    const p = nextClip("clean") ?? nextPhoto() ?? nextClip("rest");
    if (!p) break;
    auto.push(p);
  }
  if (!picks.length && !auto.length) throw new Error("No usable shots for this theme.");

  // 4) Order. Story order is capture time when most items have one, else folder/name; then time inside the clip.
  const media = [...analysis.clips, ...analysis.photos];
  const clock = captureClock(media.map((m) => m.takenAt));
  const clockOf = new Map(media.map((m, i) => [m.id, clock[i]]));
  const byTime = timeOrder(clock);
  const order = new Map((byTime ?? media.map((_, i) => i)).map((idx, pos) => [media[idx].id, pos]));
  const storyKey = (p: Pick) => order.get(p.kind === "video" ? p.clip.id : p.photo.id)! + (p.kind === "video" ? p.start / 1e4 : 0);
  let ordered: Pick[];
  // Neighbours to keep apart: two shots of one clip, and two photos (photos are breathers, never a slideshow).
  const keyOf = (p: Pick) => (p.kind === "video" ? p.clip.id : "photo");
  if (byTime) {
    // The night in capture order: Claude's opener and closer stay first and last, everything between
    // (its peak included) takes its place in time.
    const first = picks.length >= 2 ? picks[0] : undefined;
    const last = picks.length >= 2 ? picks[picks.length - 1] : undefined;
    const middle = [...picks.filter((p) => p !== first && p !== last), ...auto].sort((a, b) => storyKey(a) - storyKey(b));
    ordered = [...(first ? [first] : []), ...middle, ...(last ? [last] : [])];
    ordered = spreadApart(ordered, keyOf, { pinned: (i) => (!!first && i === 0) || (!!last && i === ordered.length - 1) });
  } else if (curated.length && picks.length) {
    // Claude's shots are anchors in Claude's order; each filler goes into the gap between the anchors
    // nearest to it in story order, so the curated arc (open → peak → close) stays intact.
    ordered = [...picks];
    const anchors = picks.map(storyKey);
    for (const p of auto.filter((x) => x.kind === "video").sort((a, b) => storyKey(a) - storyKey(b))) {
      const k = storyKey(p);
      let at = ordered.length - 1; // never after the closing shot
      for (let i = 0; i < anchors.length - 1; i++) {
        if (k >= Math.min(anchors[i], anchors[i + 1]) && k <= Math.max(anchors[i], anchors[i + 1])) {
          at = ordered.indexOf(picks[i + 1]);
          break;
        }
      }
      ordered.splice(Math.max(1, at), 0, p);
    }
    // Photo fillers have no capture time to place them by: spread them evenly between the closer and opener.
    const pics = auto.filter((x) => x.kind === "image");
    const total = ordered.length + pics.length;
    pics.forEach((p, j) => ordered.splice(clampTo(Math.round(((j + 1) * total) / (pics.length + 1)), 1, ordered.length - 1), 0, p));
    const anchorSet = new Set<Pick>(picks);
    ordered = spreadApart(ordered, keyOf, { anchor: (p) => anchorSet.has(p), pinned: (i) => i === 0 || i === ordered.length - 1 });
  } else {
    // Spread photos evenly between clips so they act as breathers, never as one block.
    const vids = auto.filter((p) => p.kind === "video").sort((a, b) => storyKey(a) - storyKey(b));
    const pics = auto.filter((p) => p.kind === "image").sort((a, b) => storyKey(a) - storyKey(b));
    ordered = [...vids];
    const total = vids.length + pics.length;
    pics.forEach((p, j) => ordered.splice(Math.min(ordered.length, Math.round(((j + 1) * total) / (pics.length + 1))), 0, p));
    const closerFixed = style.prefer === "energy" && ordered.length > 3;
    if (closerFixed) {
      // Energy-led styles end on their strongest shot.
      const scoreOf = (p: Pick) => (p.kind === "video" ? (windowsFor(p.clip, p.len, style, detailRef).find((w) => w.start === p.start)?.score ?? 0) : 0);
      let best = 0;
      ordered.forEach((p, i) => (scoreOf(p) > scoreOf(ordered[best]) ? (best = i) : null));
      ordered.push(ordered.splice(best, 1)[0]);
    }
    ordered = spreadApart(ordered, keyOf, { pinned: (i) => closerFixed && i === ordered.length - 1 });
  }

  // 5) Lengths in whole beats. Each shot gets n beats cut-to-cut; the total is fitted to the target by
  //    adding or removing single beats, spread evenly (the shortest shot relative to its base grows first),
  //    never past the cap or the footage the shot owns.
  computeRooms(ordered);
  const maxBeats = ordered.map(maxBeatsOf);
  // The opening shot also carries the title when it is drawn over it, so it needs that much more footage.
  // Not enough footage in the opening shot to hold the title as well: use a title card instead.
  if (openingTitle && ordered.length) {
    const p0 = ordered[0];
    const room = p0.kind === "image" ? capBeats + introBeats : Math.floor((rooms.get(p0)!.hi - rooms.get(p0)!.lo - 0.1 - td) / beat);
    if (room < introBeats + Math.min(2, maxBeats[0])) openingTitle = false;
    else maxBeats[0] = Math.max(1, Math.min(maxBeats[0], room - introBeats));
  }
  const base = ordered.map((p) => (p.kind === "image" ? Math.round(shotBeats * (style.prefer === "energy" ? 1 : 1.25)) : shotBeats));
  // The peak: Claude's peak shot when it sits mid-video, else the strongest moment (energy × faces) in the
  // middle stretch. Energy styles tighten toward it and burst on it: half-beat shots right at the peak (the
  // music's drop), one-beat shots either side.
  const peakScore = (p: Pick) =>
    p.kind === "video" ? (windowsFor(p.clip, p.len, style, detailRef).find((w) => w.start === p.start)?.score ?? 0) : 0.2 * faceFactor(p.photo.faces);
  const n = ordered.length;
  const [lo, hi] = [Math.max(1, Math.floor(n * 0.35)), Math.min(n - 2, Math.ceil(n * 0.8))];
  let peakIdx = picks.length >= 3 ? ordered.indexOf(picks[1]) : -1;
  if (peakIdx < lo || peakIdx > hi) {
    peakIdx = -1;
    for (let i = lo; i <= hi; i++) if (peakIdx < 0 || peakScore(ordered[i]) > peakScore(ordered[peakIdx])) peakIdx = i;
  }
  if (energetic && peakIdx > 0 && n >= 8) {
    const burst = target < 20 ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const d = i - peakIdx;
      if (d >= 0 && d < burst) base[i] = 1;
      else if ((d < 0 && d >= -3) || (d >= burst && d < burst + 4)) base[i] = Math.min(base[i], Math.max(1, Math.round(shotBeats / 2)));
    }
  }
  const beats = ordered.map((_, i) => Math.min(maxBeats[i], base[i]));
  const goal = Math.max(ordered.length, wantBeats);
  for (let guard = 0; guard < 4000; guard++) {
    const diff = goal - beats.reduce((a, b) => a + b, 0);
    if (!diff) break;
    let pick = -1;
    if (diff > 0) {
      // Burst shots (one grid unit) stay short while any other shot can still grow.
      for (let pass = 0; pass < 2 && pick < 0; pass++)
        for (let i = 0; i < beats.length; i++) if ((pass || base[i] > 1 || shotBeats <= 1) && beats[i] < maxBeats[i] && (pick < 0 || beats[i] / base[i] < beats[pick] / base[pick])) pick = i;
    } else {
      for (let i = 0; i < beats.length; i++) if (beats[i] > 1 && (pick < 0 || beats[i] / base[i] > beats[pick] / base[pick])) pick = i;
    }
    if (pick < 0) break;
    beats[pick] += Math.sign(diff);
  }

  // 6) Frames. Cut k (the midpoint of transition k) sits on beat m_k of the grid:
  //      start of sequence k  S_k = round(m_k·B + phase − T/2),  length of sequence k−1 = S_k − S_(k−1) + T.
  //    The outro absorbs whatever is left to hit the target length.
  const B = beat * fps;
  const T = Math.round(td * fps);
  const P = phase * fps;
  const layout = (bs: number[]) => {
    const cutBeat: number[] = [introBeats];
    for (const n of bs) cutBeat.push(cutBeat[cutBeat.length - 1] + n);
    const S = cutBeat.map((m) => Math.round(m * B + P - T / 2));
    // Title over the first shot: no separate card, the first shot starts the video and holds the intro's beats too.
    if (openingTitle) S[0] = 0;
    return { S, sceneFrames: bs.map((_, i) => S[i + 1] - S[i] + T) };
  };
  let { S, sceneFrames } = layout(beats);
  const introFrames = openingTitle ? 0 : S[0] + T;

  // 7) Speech. Each shot's in- and out-point should fall in a pause, not mid-sentence. First slide the shot
  //    inside the stretch of clip it owns (timing untouched); where that can't clear a phrase, move one beat
  //    between it and a neighbour. The beat total is unchanged, so every cut stays on the grid.
  const startRange = (p: Extract<Pick, { kind: "video" }>, D: number): [number, number] => {
    const r = rooms.get(p)!;
    const hi = Math.min(r.hi, p.clip.duration - 0.05) - D;
    return [r.lo, Math.max(r.lo, hi)];
  };
  const clampStart = (p: Extract<Pick, { kind: "video" }>, D: number) => {
    const [lo, hi] = startRange(p, D);
    return clampTo(p.start, lo, hi);
  };
  const placeAll = (frames: number[]) => {
    const out: { start: number; chop: number }[] = [];
    ordered.forEach((p, i) => {
      if (p.kind !== "video") return void out.push({ start: 0, chop: 0 });
      const D = frames[i] / fps;
      const s0 = clampStart(p, D);
      if (!p.clip.speech?.length) return void out.push({ start: s0, chop: 0 });
      const [lo, hi] = startRange(p, D);
      const crossings = (st: number) => p.clip.cuts.filter((c) => c > st + 0.15 && c < st + D - 0.15).length;
      const quality = (st: number) => {
        const q = p.clip.quality ?? [];
        const a = Math.floor(st / 0.5);
        const b = Math.max(a + 1, Math.ceil((st + D) / 0.5));
        let n = 0;
        for (let k = a; k < b; k++) n += q[k] ?? 1;
        return n / (b - a);
      };
      const [x0, q0] = [crossings(s0), quality(s0)];
      const radius = p.chosen ? SLIDE.chosen : SLIDE.auto;
      let best = { start: s0, cost: chopOf(p.clip, s0, D) };
      for (let k = 1; k <= Math.round(radius * fps); k++) {
        for (const st of [s0 - k / fps, s0 + k / fps]) {
          if (st < lo || st > hi || crossings(st) > x0) continue;
          const cost = chopOf(p.clip, st, D) + 0.12 * Math.abs(st - s0) + 0.5 * Math.max(0, q0 - quality(st));
          if (cost < best.cost - 1e-9) best = { start: st, cost };
        }
      }
      out.push({ start: best.start, chop: chopOf(p.clip, best.start, D) });
    });
    return out;
  };
  let placed = placeAll(sceneFrames);
  const fitted = [...beats];
  const chopSum = (xs: { chop: number }[]) => xs.reduce((n, x) => n + x.chop, 0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ordered.length; i++) {
      if (placed[i].chop <= 0.2) continue;
      let best: { beats: number[]; placed: typeof placed; gain: number } | undefined;
      for (const d of [1, -1]) {
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= ordered.length) continue;
          const nb = [...beats];
          nb[i] += d;
          nb[j] -= d;
          const ok = (k: number) => nb[k] >= 1 && nb[k] <= maxBeats[k] && Math.abs(nb[k] - fitted[k]) <= 1;
          if (!ok(i) || !ok(j)) continue;
          const np = placeAll(layout(nb).sceneFrames);
          const gain = chopSum(placed) - chopSum(np);
          if (gain > 0.15 && (!best || gain > best.gain)) best = { beats: nb, placed: np, gain };
        }
      }
      if (best) {
        beats.splice(0, beats.length, ...best.beats);
        placed = best.placed;
        ({ S, sceneFrames } = layout(beats));
      }
    }
  }
  const moved = ordered.filter((p, i) => p.kind === "video" && Math.abs(placed[i].start - clampStart(p, sceneFrames[i] / fps)) > 0.01).length;
  const resized = beats.filter((b, i) => b !== fitted[i]).length;
  if (moved || resized) notes.push(`Moved ${moved} shot start${moved === 1 ? "" : "s"}${resized ? ` and re-timed ${resized} shots by a beat` : ""} so cuts fall between sentences.`);
  const stillChopped = placed.filter((x) => x.chop > 0.3).length;
  if (stillChopped) notes.push(`${stillChopped} shot${stillChopped === 1 ? "" : "s"} still cut into speech: no pause near the beat.`);
  const target0 = folderColor(analysis);
  const outroMin = Math.max(2 * T + 1, Math.round((target < 20 ? 0.8 : 1.2) * fps));
  // The end card soaks up rounding, not a missing second of footage: a long card reads as the video stalling.
  const outroMax = Math.max(outroMin, Math.round((outroNominal + 1.2) * fps));
  const outroFrames = clampTo(Math.round(target * fps) - S[S.length - 1], outroMin, outroMax);
  const achieved = (S[S.length - 1] + outroFrames) / fps;
  if (Math.abs(achieved - target) > 1) notes.push(`Footage only supports about ${Math.round(achieved)}s at this pacing (asked for ${target}s).`);

  // Loudness: each shot's sound is brought toward the edit's typical level (±9 dB), so a shouted clip next to
  // a distant one doesn't jump. With music the median shot is the reference; without, a loud-ish one, so
  // most clips come down rather than hitting the volume ceiling.
  const baseVolume = useGenerated || driveTrack || libTrack ? style.clipVolume : 0.9;
  const levels = ordered.map((p, i) => (p.kind === "video" ? shotLevel(p.clip, placed[i].start, sceneFrames[i] / fps) : -90));
  const audible = levels.filter((l) => l >= QUIET_DB).sort((a, b) => a - b);
  const refLevel = audible.length ? audible[Math.min(audible.length - 1, Math.floor(audible.length * (baseVolume >= 0.5 ? 0.75 : 0.5)))] : 0;

  // Drop: the library track starts so its drop lands exactly on the cut into the peak (which is on the
  // grid, so the track's beats line up with every other cut too).
  const peakAt = peakIdx >= 0 ? S[peakIdx] / fps + T / fps / 2 : undefined;
  if (dropAligned && cutTrack) {
    const want = cutTrack.dropAt! - (peakAt ?? target * 0.35);
    // Too early in the track: start on the first beat whole beats before the drop instead.
    musicStart = want >= 0 ? want : mod(cutTrack.dropAt!, musicBeat);
    if (want < 0) notes.push(`The track's drop comes too early to meet the peak; it lands ${(-want).toFixed(1)}s before it.`);
  }

  // A short speed ramp into the peak for energy styles: the shot before it plays at 1.5× when its clip has the footage.
  const speeds = ordered.map(() => 1);
  if (energetic && peakIdx > 0) {
    const p = ordered[peakIdx - 1];
    if (p.kind === "video" && placed[peakIdx - 1].start + (sceneFrames[peakIdx - 1] / fps) * 1.5 <= Math.min(rooms.get(p)!.hi, p.clip.duration - 0.1)) speeds[peakIdx - 1] = 1.5;
  }

  // Time-of-day chips, only when the edit follows capture time.
  const chips = byTime
    ? timeChips(
        ordered.map((p, i) => {
          const t0 = clockOf.get(p.kind === "video" ? p.clip.id : p.photo.id);
          // The opener carries the title and the closer the end card; and both are placed by role, not by time.
          if (i === 0 || i === ordered.length - 1) return { at: S[i] / fps };
          return { at: S[i] / fps, ms: t0 === undefined ? undefined : t0 + (p.kind === "video" ? placed[i].start * 1000 : 0) };
        }),
      )
    : ordered.map(() => undefined);

  const scenes: Scene[] = ordered.map((p, i) => {
    const id = `s${i + 1}`;
    const duration = r3(sceneFrames[i] / fps);
    const chip = chips[i] ? { chip: chips[i] } : {};
    if (p.kind === "image") {
      const motions = ["zoomIn", "panRight", "zoomOut", "panLeft"] as const;
      const grade = target0 && p.photo.color ? gradeToward(p.photo.color, target0) : undefined;
      const focus = focusOf(p.photo.faces);
      return { id, kind: "image", src: p.photo.proxy, duration, motion: motions[i % 4], caption: p.caption, ...(grade ? { grade } : {}), ...(focus ? { focus } : {}), ...chip };
    }
    // The shot keeps its full length (it's on the grid); placeAll kept it inside the footage it owns.
    const speed = speeds[i];
    const trimStart = Math.max(0, Math.min(placed[i].start, p.clip.duration - duration * speed));
    const focus = focusOf(faceAt(p.clip, trimStart + (duration * speed) / 2));
    const colour = target0 ? windowColor(p.clip, trimStart, duration) : undefined;
    const grade = colour && target0 ? gradeToward(colour, target0) : undefined;
    // Speech and subtitles near the shot, in source time, with a margin so a re-trim in the editor keeps them.
    const near = <X extends { start: number; end: number }>(xs: X[] | undefined) => (xs ?? []).filter((x) => x.end > trimStart - SPEECH_MARGIN && x.start < trimStart + duration + SPEECH_MARGIN);
    const speech = near((p.clip.speech ?? []).map(([a, b]) => ({ start: a, end: b }))).map((x): [number, number] => [x.start, x.end]);
    const captions: CaptionCue[] = near(p.clip.transcript);
    const volume = r3(Math.min(1, baseVolume * 10 ** (levelGainDb(levels[i], refLevel) / 20)));
    return {
      ...(grade ? { grade } : {}),
      ...(speech.length ? { speech } : {}),
      ...(captions.length ? { captions } : {}),
      id,
      kind: "video",
      src: p.clip.proxy,
      trimStart: r3(trimStart),
      sourceDuration: p.clip.duration,
      duration,
      volume,
      speed,
      srcWidth: p.clip.width,
      srcHeight: p.clip.height,
      caption: p.caption,
      ...(focus ? { focus } : {}),
      ...chip,
    };
  });

  // End card over the closing shot, blurred: a photo as is, a clip carrying on where its shot ends.
  const closer = ordered[ordered.length - 1];
  const lastScene = scenes[scenes.length - 1];
  const backdrop =
    closer.kind === "image"
      ? { src: closer.photo.proxy, kind: "image" as const }
      : lastScene.kind === "video"
        ? { src: closer.clip.proxy, kind: "video" as const, trimStart: r3(Math.max(0, Math.min(lastScene.trimStart + lastScene.duration * lastScene.speed, closer.clip.duration - outroFrames / fps - 0.1))) }
        : undefined;
  const dateLine = dateRangeLabel(clock);

  const generatedSeconds = Math.ceil(target + MUSIC_HEADROOM);
  const libSeconds = cutTrack ? r3(Math.min(cutTrack.duration - musicStart, target + MUSIC_HEADROOM)) : 0;
  const plan = EditPlan.parse({
    version: 1,
    title: theme.title,
    subtitle: theme.subtitle,
    occasion: analysis.occasion,
    themeName: theme.name,
    styleId: theme.styleId,
    aspect,
    fps,
    palette: { ...style.palette, ...(theme.accentColor ? { accent: theme.accentColor } : {}) },
    assetBase: "",
    music:
      musicMode === "none"
        ? null
        : cutTrack
          ? { src: `assets/music-${theme.id}.mp3`, volume: 0.8, bpm, credit: cutTrack.credit, duration: libSeconds }
          : driveTrack
            ? { src: driveTrack.proxy, volume: 0.8, bpm, credit: driveTrack.name, duration: driveTrack.duration }
            : { src: "assets/music.wav", volume: 0.7, bpm, credit: "Generated soundtrack", duration: generatedSeconds },
    intro: { duration: r3(introFrames / fps) },
    ...(openingTitle ? { opening: { letterbox: true } } : {}),
    ...(dateLine ? { dateLine } : {}),
    outro: { text: theme.outroText, duration: r3(outroFrames / fps), ...(backdrop ? { backdrop } : {}) },
    transition: { type: style.transition.type, duration: r3(T / fps) },
    scenes,
  });

  return {
    plan,
    musicNeeded:
      musicMode === "none"
        ? null
        : cutTrack
          ? { kind: "library", path: cutTrack.path, start: r3(musicStart), seconds: libSeconds }
          : driveTrack
            ? { kind: "drive", src: driveTrack.proxy }
            : { kind: "generated", seconds: generatedSeconds },
    notes,
  };
}

/**
 * Where each cut (transition midpoint) falls, in seconds. Used by tests and reported to Claude so the
 * beat sync claim is checkable.
 */
export function cutTimes(plan: EditPlan, segs: { frames: number }[], transitionAt: (a: number, b: number) => number) {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const tr = transitionAt(segs[i].frames, segs[i + 1].frames);
    t += segs[i].frames - tr;
    out.push((t + tr / 2) / plan.fps);
  }
  return out;
}
