import { z } from "zod";
import { AspectRatio, EditPlan, type Scene } from "../shared/plan";
import { STYLES, STYLE_IDS, type StyleDef } from "../shared/styles";
import { musicFor } from "../shared/occasions";
import type { Analysis, ClipInfo, PhotoInfo } from "./analyze";

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
  music: z.enum(["drive", "generated", "none"]).optional().describe("'drive' uses an audio file from the folder, 'generated' makes a matching track. Defaults to drive if present"),
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

type Window = { clip: ClipInfo; start: number; len: number; score: number };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Scores every possible shot of length `len` in a clip. Shots that span a hard cut inside the clip are
 * skipped, and moments the analysis marked as dark or smeared (motion blur, shaky pans) score lower.
 */
function windowsFor(clip: ClipInfo, len: number, style: StyleDef): Window[] {
  const out: Window[] = [];
  const usable = clip.duration - 0.15;
  if (usable < len) {
    // Clip shorter than a shot: use all of it.
    return [{ clip, start: 0, len: Math.max(0.5, usable), score: 0.3 }];
  }
  const w = style.prefer === "energy" ? { e: 0.5, m: 0.5, s: 0 } : style.prefer === "calm" ? { e: 0.25, m: 0.05, s: 0.7 } : { e: 0.35, m: 0.35, s: 0.3 };
  for (let start = clip.duration > len + 0.6 ? 0.3 : 0; start + len <= usable; start += 0.5) {
    if (clip.cuts.some((c) => c > start + 0.15 && c < start + len - 0.15)) continue;
    const a = Math.floor(start / 0.5);
    const b = Math.max(a + 1, Math.ceil((start + len) / 0.5));
    let e = 0;
    let m = 0;
    let q = 0;
    let k = 0;
    for (let i = a; i < b && i < clip.energy.length; i++, k++) {
      e += clip.energy[i] ?? 0;
      m += clip.motion[i] ?? 0;
      q += clip.quality?.[i] ?? 1;
    }
    e /= Math.max(1, k);
    m /= Math.max(1, k);
    q /= Math.max(1, k);
    out.push({ clip, start, len, score: (w.e * e + w.m * m + w.s * (1 - m)) * (0.25 + 0.75 * q) });
  }
  return out;
}

const overlaps = (a: { start: number; len: number }, b: { start: number; len: number }, gap = 0.4) =>
  a.start < b.start + b.len + gap && b.start < a.start + a.len + gap;

export type BuildResult = { plan: EditPlan; musicNeeded: { kind: "generated"; seconds: number } | { kind: "drive"; src: string } | null; notes: string[] };

/** Extra soundtrack beyond the target, so lengthening the video in the editor doesn't run out of music. */
const MUSIC_HEADROOM = 20;

export function buildPlan(analysis: Analysis, theme: Theme, opts: { durationOverride?: number } = {}): BuildResult {
  const style = STYLES[theme.styleId];
  const notes: string[] = [];
  const target = Math.max(8, Math.min(300, opts.durationOverride ?? analysis.targetDuration));
  const aspect = theme.aspect ?? analysis.suggestedAspect;
  const fps = 30 as const;

  const musicMode = theme.music ?? (analysis.audio.length ? "drive" : "generated");
  const driveTrack = musicMode === "drive" ? [...analysis.audio].sort((a, b) => b.duration - a.duration)[0] : undefined;
  if (musicMode === "drive" && !driveTrack) notes.push("No audio file in the folder, so a matching track was generated.");
  const useGenerated = musicMode === "generated" || (musicMode === "drive" && !driveTrack);

  // The beat grid: the Drive song's detected tempo and first beat, or the generated track's (beat one at 0).
  const music = musicFor(style, analysis.occasion);
  const bpm = driveTrack?.bpm ?? music.bpm;
  const phase = driveTrack?.bpm ? (driveTrack.beatOffset ?? 0) : 0;
  if (driveTrack && !driveTrack.bpm) notes.push(`Couldn't detect the tempo of "${driveTrack.name}", so cuts follow the style's ${bpm} BPM.`);
  const beat = 60 / bpm;

  const shotBeats = Math.max(2, Math.round(style.shotLength / beat));
  const shot = shotBeats * beat; // cut-to-cut
  const td = style.transition.type === "none" ? 0 : Math.min(style.transition.duration, beat * 0.9, shot / 3);
  const introBeats = target < 20 ? Math.max(2, Math.round(2 / beat)) : Math.max(Math.ceil(2.5 / beat), Math.min(Math.floor(4 / beat), Math.round((target * 0.07) / beat)));
  const outroNominal = target < 20 ? 1.6 : 2.6;
  const body = target - introBeats * beat - phase - outroNominal;
  const nAuto = Math.max(1, Math.round(body / shot));

  // Photos get a share of the timeline proportional to how much of the folder they are, capped at 40%.
  const photos = analysis.photos;
  const clips = analysis.clips;
  const photoShare = clips.length ? Math.min(0.4, photos.length / (photos.length + clips.length * 2)) : 1;
  const nPhotos = photos.length ? Math.max(clips.length ? 0 : 1, Math.round(nAuto * photoShare)) : 0;
  const nClips = clips.length ? nAuto - nPhotos : 0;

  type Pick = { kind: "video"; clip: ClipInfo; start: number; len: number; caption?: string } | { kind: "image"; photo: PhotoInfo; caption?: string };
  const picks: Pick[] = [];
  // A clip plays for its whole sequence, including the transition overlap.
  const seqLen = shot + td;

  // 1) Claude's curated shots, in its order.
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const curated = theme.shots ?? [];
  for (const s of curated) {
    const clip = clipById.get(s.id);
    const photo = photoById.get(s.id);
    if (clip) {
      let start = s.start;
      const len = Math.min(seqLen, Math.max(0.5, clip.duration - 0.15));
      if (start === undefined) start = windowsFor(clip, len, style).sort((a, b) => b.score - a.score)[0]?.start ?? 0;
      start = Math.max(0, Math.min(start, clip.duration - len - 0.05));
      picks.push({ kind: "video", clip, start, len, caption: s.caption });
    } else if (photo) picks.push({ kind: "image", photo, caption: s.caption });
    else notes.push(`Ignored unknown shot id "${s.id}".`);
  }

  // 2) Fill the gaps with the best remaining moments, round-robin across clips so the folder is well covered.
  const autoClips = Math.max(0, nClips - picks.filter((p) => p.kind === "video").length);
  const autoPhotos = Math.max(0, nPhotos - picks.filter((p) => p.kind === "image").length);
  const auto: Pick[] = [];
  if (picks.length < nAuto && autoClips > 0) {
    const used = new Map<string, { start: number; len: number }[]>();
    for (const p of picks) if (p.kind === "video") used.set(p.clip.id, [...(used.get(p.clip.id) ?? []), p]);
    const pools = clips
      .map((c) => ({ clip: c, wins: windowsFor(c, seqLen, style).sort((a, b) => b.score - a.score) }))
      .sort((a, b) => (b.wins[0]?.score ?? 0) - (a.wins[0]?.score ?? 0));
    let guard = 0;
    while (auto.length < autoClips && guard++ < 50) {
      let progressed = false;
      for (const { clip, wins } of pools) {
        if (auto.length >= autoClips) break;
        const taken = used.get(clip.id) ?? [];
        const w = wins.find((x) => taken.every((t) => !overlaps(t, x)));
        if (!w) continue;
        used.set(clip.id, [...taken, w]);
        auto.push({ kind: "video", clip, start: w.start, len: w.len });
        progressed = true;
      }
      if (!progressed) break;
    }
  }
  if (autoPhotos > 0) {
    const usedPhotos = new Set(picks.flatMap((p) => (p.kind === "image" ? [p.photo.id] : [])));
    const free = photos.filter((p) => !usedPhotos.has(p.id));
    const n = Math.min(autoPhotos, free.length);
    for (let j = 0; j < n; j++) auto.push({ kind: "image", photo: free[Math.floor(((j + 0.5) * free.length) / n)] });
  }
  if (!picks.length && !auto.length) throw new Error("No usable shots for this theme.");

  // 3) Order. Story order is folder/name (usually capture time), then time inside the clip.
  const order = new Map([...clips, ...photos].map((m, i) => [m.id, i]));
  const storyKey = (p: Pick) => order.get(p.kind === "video" ? p.clip.id : p.photo.id)! + (p.kind === "video" ? p.start / 1e4 : 0);
  let ordered: Pick[];
  if (curated.length) {
    // Claude's shots are anchors in Claude's order; each filler goes into the gap between the anchors
    // nearest to it in story order, so the curated arc (open → peak → close) stays intact.
    ordered = [...picks];
    const anchors = picks.map(storyKey);
    for (const p of auto.sort((a, b) => storyKey(a) - storyKey(b))) {
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
  } else {
    // Spread photos evenly between clips so they act as breathers, never as one block.
    const vids = auto.filter((p) => p.kind === "video").sort((a, b) => storyKey(a) - storyKey(b));
    const pics = auto.filter((p) => p.kind === "image").sort((a, b) => storyKey(a) - storyKey(b));
    ordered = [...vids];
    const total = vids.length + pics.length;
    pics.forEach((p, j) => ordered.splice(Math.min(ordered.length, Math.round(((j + 1) * total) / (pics.length + 1))), 0, p));
    if (style.prefer === "energy" && ordered.length > 3) {
      // Energy-led styles end on their strongest shot.
      const scoreOf = (p: Pick) => (p.kind === "video" ? (windowsFor(p.clip, p.len, style).find((w) => w.start === p.start)?.score ?? 0) : 0);
      let best = 0;
      ordered.forEach((p, i) => (scoreOf(p) > scoreOf(ordered[best]) ? (best = i) : null));
      ordered.push(ordered.splice(best, 1)[0]);
    }
  }

  // 4) Lengths in whole beats. Each shot gets n beats cut-to-cut; the total is fitted to the target by
  //    adding or removing single beats where there's room (photos and long clips first).
  const maxBeats = ordered.map((p) =>
    p.kind === "image" ? shotBeats * 3 : Math.max(1, Math.floor((p.clip.duration - 0.05 - td) / beat)),
  );
  const beats = ordered.map((p, i) => Math.min(maxBeats[i], p.kind === "image" ? Math.round(shotBeats * 1.25) : shotBeats));
  const wantBeats = Math.max(ordered.length, Math.round((target - outroNominal - phase) / beat) - introBeats);
  for (let guard = 0; guard < 2000; guard++) {
    const diff = wantBeats - beats.reduce((a, b) => a + b, 0);
    if (!diff) break;
    let pick = -1;
    if (diff > 0) {
      // Grow the shot with the most headroom relative to its length.
      for (let i = 0; i < beats.length; i++) if (beats[i] < maxBeats[i] && (pick < 0 || maxBeats[i] - beats[i] > maxBeats[pick] - beats[pick])) pick = i;
    } else {
      for (let i = 0; i < beats.length; i++) if (beats[i] > 1 && (pick < 0 || beats[i] > beats[pick])) pick = i;
    }
    if (pick < 0) break;
    beats[pick] += Math.sign(diff);
  }

  // 5) Frames. Cut k (the midpoint of transition k) sits on beat m_k of the grid:
  //      start of sequence k  S_k = round(m_k·B + phase − T/2),  length of sequence k−1 = S_k − S_(k−1) + T.
  //    The outro absorbs whatever is left to hit the target length.
  const B = beat * fps;
  const T = Math.round(td * fps);
  const P = phase * fps;
  const cutBeat: number[] = [introBeats];
  for (const n of beats) cutBeat.push(cutBeat[cutBeat.length - 1] + n);
  const S = cutBeat.map((m) => Math.round(m * B + P - T / 2));
  const introFrames = S[0] + T;
  const sceneFrames = beats.map((_, i) => S[i + 1] - S[i] + T);
  const outroMin = Math.max(2 * T + 1, Math.round((target < 20 ? 1.2 : 1.8) * fps));
  const outroFrames = Math.max(outroMin, Math.round(target * fps) - S[S.length - 1]);
  const achieved = (S[S.length - 1] + outroFrames) / fps;
  if (Math.abs(achieved - target) > 1) notes.push(`Footage only supports about ${Math.round(achieved)}s at this pacing (asked for ${target}s).`);

  const scenes: Scene[] = ordered.map((p, i) => {
    const id = `s${i + 1}`;
    const duration = r3(sceneFrames[i] / fps);
    if (p.kind === "image") {
      const motions = ["zoomIn", "panRight", "zoomOut", "panLeft"] as const;
      return { id, kind: "image", src: p.photo.proxy, duration, motion: motions[i % 4], caption: p.caption };
    }
    // Keep the shot's length (it's on the grid); if the clip would run out, start a little earlier instead.
    const trimStart = Math.max(0, Math.min(p.start, p.clip.duration - 0.05 - duration));
    return {
      id,
      kind: "video",
      src: p.clip.proxy,
      trimStart: r3(trimStart),
      sourceDuration: p.clip.duration,
      duration: r3(Math.min(duration, p.clip.duration - trimStart)),
      volume: useGenerated || driveTrack ? style.clipVolume : 0.9,
      speed: 1,
      srcWidth: p.clip.width,
      srcHeight: p.clip.height,
      caption: p.caption,
    };
  });

  const generatedSeconds = Math.ceil(target + MUSIC_HEADROOM);
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
        : driveTrack
          ? { src: driveTrack.proxy, volume: 0.8, bpm, credit: driveTrack.name, duration: driveTrack.duration }
          : { src: "assets/music.wav", volume: 0.7, bpm, credit: "Generated soundtrack", duration: generatedSeconds },
    intro: { duration: r3(introFrames / fps) },
    outro: { text: theme.outroText, duration: r3(outroFrames / fps) },
    transition: { type: style.transition.type, duration: r3(T / fps) },
    scenes,
  });

  return {
    plan,
    musicNeeded: musicMode === "none" ? null : driveTrack ? { kind: "drive", src: driveTrack.proxy } : { kind: "generated", seconds: generatedSeconds },
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
