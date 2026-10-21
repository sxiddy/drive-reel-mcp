import { timelineSegments, transitionFrames, type EditPlan, type VideoScene } from "../shared/plan";

/** Speech mix: the clip's voice comes up to SPEECH_VOLUME and the music drops by DUCK_DB, with RAMP_S ramps. */
export const SPEECH_VOLUME = 1;
export const DUCK_DB = -10;
export const RAMP_S = 0.15;

type Span = [number, number];

/** Raised-cosine 0→1 over [0, 1], for clicks-free ramps. */
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));

/**
 * How much speech is "on" at frame f (0..1): 1 inside a span, easing in over `ramp` frames before it and
 * out over `ramp` frames after it, so the duck is already down when the first word lands.
 */
export function speechPresence(f: number, spans: readonly Span[], ramp: number): number {
  let p = 0;
  for (const [a, b] of spans) {
    if (f >= a && f <= b) return 1;
    if (f < a && f > a - ramp) p = Math.max(p, ease((f - (a - ramp)) / ramp));
    if (f > b && f < b + ramp) p = Math.max(p, ease((b + ramp - f) / ramp));
  }
  return p;
}

/** A scene's speech in its own frames (0 = first frame of its sequence), clipped to the sequence. */
export function sceneSpeechFrames(scene: Pick<VideoScene, "speech" | "trimStart" | "speed">, frames: number, fps: number): Span[] {
  const out: Span[] = [];
  for (const [a, b] of scene.speech ?? []) {
    const fa = ((a - scene.trimStart) / scene.speed) * fps;
    const fb = ((b - scene.trimStart) / scene.speed) * fps;
    if (fb <= 0 || fa >= frames) continue;
    out.push([Math.max(0, fa), Math.min(frames, fb)]);
  }
  return out;
}

/** Shortest fade at a scene's edges (s): even a hard cut gets this, so the clip's sound never clicks in or out. */
export const EDGE_S = 0.1;

/** Equal-power fade-in over `len` frames: sin(π/2·x), so two overlapping clips keep a steady combined level. */
const equalPower = (f: number, len: number) => (len <= 0 ? 1 : Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, f / len))));

/**
 * Clip volume at scene frame f: the scene's own level, lifted to SPEECH_VOLUME while someone talks. A scene
 * set to volume 0 stays muted. Every scene fades in and out at its edges: over the transition it shares with
 * its neighbour (equal-power, so a crossfade doesn't dip or bump) and never faster than EDGE_S, so a cut
 * doesn't click; a phrase cut by the edit fades rather than clicks too.
 */
export function sceneVolume(
  scene: Pick<VideoScene, "speech" | "trimStart" | "speed" | "volume">,
  f: number,
  frames: number,
  fps: number,
  fade: { in?: number; out?: number } = {},
): number {
  if (scene.volume <= 0) return 0;
  const edge = EDGE_S * fps;
  const fin = Math.min(frames / 2, Math.max(edge, fade.in ?? 0));
  const fout = Math.min(frames / 2, Math.max(edge, fade.out ?? 0));
  const env = equalPower(f, fin) * equalPower(frames - f, fout);
  if (!scene.speech?.length) return scene.volume * env;
  const ramp = RAMP_S * fps;
  const p = speechPresence(f, sceneSpeechFrames(scene, frames, fps), ramp);
  return (scene.volume + (Math.max(scene.volume, SPEECH_VOLUME) - scene.volume) * p) * env;
}

/** First frame of each timeline sequence (intro, scenes, outro), matching the TransitionSeries layout. */
export function sequenceStarts(plan: EditPlan): Map<string, { from: number; frames: number }> {
  const segs = timelineSegments(plan);
  const out = new Map<string, { from: number; frames: number }>();
  let from = 0;
  segs.forEach((seg, i) => {
    if (i > 0) from += segs[i - 1].frames - transitionFrames(plan, segs[i - 1].frames, seg.frames);
    out.set(seg.key, { from, frames: seg.frames });
  });
  return out;
}

/** Every stretch of audible speech on the whole timeline, in frames, merged. Muted scenes don't count. */
export function speechTimeline(plan: EditPlan): Span[] {
  const starts = sequenceStarts(plan);
  const spans: Span[] = [];
  for (const s of plan.scenes) {
    if (s.kind !== "video" || s.volume <= 0 || !s.speech?.length) continue;
    const at = starts.get(s.id);
    if (!at) continue;
    for (const [a, b] of sceneSpeechFrames(s, at.frames, plan.fps)) spans.push([at.from + a, at.from + b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: Span[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  return merged;
}

/** Music gain at a global frame: 1, or DUCK_DB down under speech, with smooth ramps. */
export function musicDuck(f: number, spans: readonly Span[], fps: number): number {
  if (!spans.length) return 1;
  const p = speechPresence(f, spans, RAMP_S * fps);
  return 1 - (1 - 10 ** (DUCK_DB / 20)) * p;
}
