import { z } from "zod";
import { STYLE_IDS } from "./styles";

/**
 * The edit plan is the single source of truth for a video. The MCP server writes it,
 * Remotion renders it, and the website's editor changes it and renders it again.
 * Asset paths are relative to `assetBase`, so the same plan works locally and on the site.
 */

export const TransitionType = z.enum(["fade", "slide", "wipe", "clockWipe", "iris", "pushCut", "flip", "none"]);
export type TransitionType = z.infer<typeof TransitionType>;

export const AspectRatio = z.enum(["16:9", "9:16", "1:1"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

const SceneBase = z.object({
  id: z.string(),
  /** Seconds this scene stays on screen, not counting the transition overlap. */
  duration: z.number().min(0.4).max(60),
  caption: z.string().max(140).optional(),
});

/**
 * Per-shot colour correction that pulls footage from different phones toward the folder's typical colour,
 * applied before the style's own look. In order, on display (gamma-encoded) RGB in 0..1:
 *   white balance  c' = gain[c] · c          (cast removal; gains ≥ 1 so whites stay white)
 *   exposure       c' = c'^gamma             (< 1 lifts the midtones, > 1 lowers them; black and white stay put)
 *   saturation     c' = Y + saturation·(c' − Y)   (Y = Rec.709 luma)
 */
export const Grade = z.object({
  gain: z.tuple([z.number().min(0.5).max(1.5), z.number().min(0.5).max(1.5), z.number().min(0.5).max(1.5)]),
  gamma: z.number().min(0.5).max(2),
  saturation: z.number().min(0.5).max(1.5),
});
export type Grade = z.infer<typeof Grade>;

/** [start, end] seconds in the scene's SOURCE clip (not scene time), so they stay right when the shot is re-trimmed. */
export const SpeechWindow = z.tuple([z.number().min(0), z.number().min(0)]);
export type SpeechWindow = z.infer<typeof SpeechWindow>;

/** One subtitle, timed in seconds of the scene's SOURCE clip. */
export const CaptionCue = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().min(1).max(200) });
export type CaptionCue = z.infer<typeof CaptionCue>;

export const VideoScene = SceneBase.extend({
  kind: z.literal("video"),
  src: z.string(),
  /** Where in the source clip to start, in seconds. */
  trimStart: z.number().min(0),
  /** Source clip length in seconds, so editors can clamp trims. */
  sourceDuration: z.number().positive(),
  volume: z.number().min(0).max(1).default(0.15),
  speed: z.number().min(0.25).max(2).default(1),
  /** Source frame size; when its shape differs from the video's, the clip sits on a blurred fill instead of being cropped. */
  srcWidth: z.number().positive().optional(),
  srcHeight: z.number().positive().optional(),
  grade: Grade.optional(),
  /**
   * Where someone talks in the source clip (near this shot). The clip's own audio is lifted there and the
   * music ducked under it; volume 0 keeps the shot muted.
   */
  speech: z.array(SpeechWindow).max(300).optional(),
  /** Subtitles for what is said, timed against the source clip. */
  captions: z.array(CaptionCue).max(500).optional(),
});

export const ImageScene = SceneBase.extend({
  kind: z.literal("image"),
  src: z.string(),
  /** Ken Burns direction. */
  motion: z.enum(["zoomIn", "zoomOut", "panLeft", "panRight"]).default("zoomIn"),
  grade: Grade.optional(),
});

export const CARD_ICONS = ["book", "clock", "chart", "users", "spark", "check", "calendar", "chat", "bolt", "star", "target", "bulb", "search", "shield", "rocket", "heart"] as const;
export type CardIcon = (typeof CARD_ICONS)[number];

/** Pure motion-graphics scene: used for the no-footage route and for chapter cards. */
export const CardScene = SceneBase.extend({
  kind: z.literal("card"),
  /**
   * statement: big kinetic headline · bullets: list revealed on the beat · stat: animated counter ·
   * quote: pull quote (heading = quote, body = who said it) · feature: icon + headline + body ·
   * screenshot: product image in a device frame beside the text. Inferred from the fields when omitted.
   */
  layout: z.enum(["statement", "bullets", "stat", "quote", "feature", "screenshot"]).optional(),
  heading: z.string().max(80),
  body: z.string().max(220).optional(),
  /** Short label above the heading, e.g. "01" or "NEW". */
  kicker: z.string().max(24).optional(),
  /** Optional bullet points, revealed one by one. */
  bullets: z.array(z.string().max(60)).max(4).optional(),
  /** Counter that animates up to `value`, e.g. { value: 12000, suffix: "+", label: "notes shared" }. */
  stat: z.object({ value: z.number(), prefix: z.string().max(4).optional(), suffix: z.string().max(6).optional(), label: z.string().max(40) }).optional(),
  icon: z.enum(CARD_ICONS).optional(),
  /** Relative asset path of a product screenshot, shown in a device frame. */
  image: z.string().optional(),
  device: z.enum(["laptop", "phone"]).optional(),
});

export const Scene = z.discriminatedUnion("kind", [VideoScene, ImageScene, CardScene]);
export type Scene = z.infer<typeof Scene>;
export type VideoScene = z.infer<typeof VideoScene>;
export type ImageScene = z.infer<typeof ImageScene>;
export type CardScene = z.infer<typeof CardScene>;

export const Palette = z.object({
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
});
export type Palette = z.infer<typeof Palette>;

export const EditPlan = z.object({
  version: z.literal(1),
  title: z.string().max(80),
  subtitle: z.string().max(120).optional(),
  occasion: z.string().max(80),
  themeName: z.string().max(60),
  styleId: z.enum(STYLE_IDS),
  aspect: AspectRatio,
  fps: z.literal(30),
  palette: Palette,
  /** URL prefix for assets; empty string means "relative to the page". */
  assetBase: z.string(),
  music: z
    .object({
      src: z.string(),
      volume: z.number().min(0).max(1),
      bpm: z.number().min(40).max(200),
      credit: z.string().optional(),
      /** Track length in seconds, so a video longer than its track can loop it smoothly. */
      duration: z.number().positive().optional(),
    })
    .nullable(),
  intro: z.object({ duration: z.number().min(0).max(8) }),
  outro: z.object({ text: z.string().max(80), duration: z.number().min(0).max(8) }),
  transition: z.object({ type: TransitionType, duration: z.number().min(0).max(1.5) }),
  scenes: z.array(Scene).min(1).max(120),
});
export type EditPlan = z.infer<typeof EditPlan>;

export const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

const toFrames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

/** Every sequence on the timeline (intro, scenes, outro), in frames. */
export function timelineSegments(plan: EditPlan) {
  const segs: { key: string; frames: number }[] = [];
  if (plan.intro.duration > 0) segs.push({ key: "intro", frames: toFrames(plan.intro.duration, plan.fps) });
  for (const s of plan.scenes) segs.push({ key: s.id, frames: toFrames(s.duration, plan.fps) });
  if (plan.outro.duration > 0) segs.push({ key: "outro", frames: toFrames(plan.outro.duration, plan.fps) });
  return segs;
}

/**
 * Transition length in frames, clamped so it never exceeds half of the shorter neighbour.
 * TransitionSeries throws if a transition is longer than either adjacent sequence.
 */
export function transitionFrames(plan: EditPlan, a: number, b: number) {
  if (plan.transition.type === "none") return 0;
  const want = toFrames(plan.transition.duration, plan.fps);
  return Math.max(0, Math.min(want, Math.floor(Math.min(a, b) / 2)));
}

/** Total length: sequences minus the overlap each transition creates. */
export function planDurationInFrames(plan: EditPlan) {
  const segs = timelineSegments(plan);
  let total = segs.reduce((n, s) => n + s.frames, 0);
  for (let i = 1; i < segs.length; i++) total -= transitionFrames(plan, segs[i - 1].frames, segs[i].frames);
  return Math.max(1, total);
}

export function resolveAsset(plan: Pick<EditPlan, "assetBase">, src: string) {
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  const base = plan.assetBase.replace(/\/$/, "");
  return base ? `${base}/${src.replace(/^\//, "")}` : src;
}

/** Asset paths must be plain relative paths inside the video's folder: no scheme, no "..", no absolute paths. */
export function isSafeAssetPath(p: string) {
  return /^[\w][\w\-. /]*$/.test(p) && !p.split("/").includes("..") && !/^[a-z]+:/i.test(p);
}

/** Every asset a plan points at (clips, photos, card images, music). */
export function planAssetPaths(plan: Pick<EditPlan, "scenes" | "music">): string[] {
  const set = new Set<string>();
  for (const s of plan.scenes) {
    if (s.kind !== "card") set.add(s.src);
    else if (s.image) set.add(s.image);
  }
  if (plan.music) set.add(plan.music.src);
  return [...set];
}
