import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { pushCut } from "@remotion/transitions/push-cut";
import { flip } from "@remotion/transitions/flip";
import {
  planDurationInFrames,
  resolveAsset,
  timelineSegments,
  transitionFrames,
  type EditPlan,
  type ImageScene,
  type VideoScene,
} from "../shared/plan";
import { CardView, MotionIntro, MotionOutro } from "./cards";
import { AnimatedHeading, BodyText, Caption, Graded, Overlays, Subtitles, makeLook, textShadow, useCorrection, type Look } from "./components";
import { musicDuck, sceneVolume, speechTimeline } from "./audio";
import { MotionField } from "./motion";
import { whip } from "./whip";
import { BackdropOutro, OpeningTitle, TimeChip, framing } from "./opening";

const SLIDE_DIRS = ["from-right", "from-bottom", "from-left", "from-top"] as const;
const WIPE_DIRS = ["from-left", "from-top-right", "from-right", "from-bottom-left"] as const;

// TransitionSeries needs a presentation per transition; vary the direction so long reels don't feel repetitive.
function presentationFor(plan: EditPlan, index: number, width: number, height: number): TransitionPresentation<Record<string, unknown>> {
  const t = plan.transition.type;
  const p = (() => {
    switch (t) {
      case "slide":
        return slide({ direction: SLIDE_DIRS[index % SLIDE_DIRS.length] });
      case "wipe":
        return wipe({ direction: WIPE_DIRS[index % WIPE_DIRS.length] });
      case "clockWipe":
        return index % 2 ? clockWipe({ width, height }) : iris({ width, height });
      case "iris":
        return iris({ width, height });
      case "pushCut":
        return pushCut({ flashColor: "#ffffff", flashOpacity: 0.55 });
      case "flip":
        return flip({ direction: SLIDE_DIRS[index % SLIDE_DIRS.length] });
      case "whip":
        return whip({ direction: index % 3 === 2 ? -1 : 1, width });
      default:
        return fade();
    }
  })();
  return p as unknown as TransitionPresentation<Record<string, unknown>>;
}

/** True when the clip's shape differs from the frame's by more than ~15% (e.g. a 9:16 phone clip in a 16:9 video). */
export function needsContainedFit(scene: Pick<VideoScene, "srcWidth" | "srcHeight">, width: number, height: number) {
  if (!scene.srcWidth || !scene.srcHeight) return false;
  const ratio = scene.srcWidth / scene.srcHeight / (width / height);
  return ratio < 1 / 1.15 || ratio > 1.15;
}

const VideoView: React.FC<{ scene: VideoScene; plan: EditPlan; look: Look; frames: number; edges: { in: number; out: number }; opening?: boolean }> = ({ scene, plan, look, frames, edges, opening }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // Slow push-in for calm styles; quick punch-in that settles for energetic ones.
  const scale =
    look.style.prefer === "energy"
      ? interpolate(spring({ frame, fps, config: { damping: 30 } }), [0, 1], [1.12, 1.03])
      : interpolate(frame, [0, frames], [1.0, 1.07]);
  const src = resolveAsset(plan, scene.src);
  const trimBefore = Math.round(scene.trimStart * fps);
  const corr = useCorrection(scene.grade);
  // The clip's own sound: its set level, lifted while someone talks (the music ducks under it, see Music).
  const volume = (f: number) => sceneVolume(scene, f, frames, fps, edges);
  const words = scene.captions?.length ? (
    <Subtitles cues={scene.captions} look={look} trimStart={scene.trimStart} speed={scene.speed} durationInFrames={frames} aboveCaption={!!scene.caption} />
  ) : null;

  // A clip shaped unlike the frame (a phone clip in 16:9) fills it, reframed on where people usually are:
  // the upper third of a portrait shot. Small letterboxed clips over blurred bars read as amateur.
  const reframe = framing(scene, needsContainedFit(scene, width, height) ? (scene.srcHeight! > scene.srcWidth! ? "50% 32%" : "50% 50%") : "50% 50%");

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {corr.defs}
      <Graded look={look} correction={corr.filter}>
        <AbsoluteFill style={{ transform: `scale(${scale})` }}>
          <OffthreadVideo src={src} trimBefore={trimBefore} playbackRate={scene.speed} volume={volume} pauseWhenBuffering style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: reframe }} />
        </AbsoluteFill>
      </Graded>
      {scene.caption ? <Caption text={scene.caption} look={look} durationInFrames={frames} /> : null}
      {words}
      {scene.chip ? <TimeChip text={scene.chip} look={look} frames={frames} /> : null}
      {opening ? <OpeningTitle plan={plan} look={look} frames={frames} /> : null}
    </AbsoluteFill>
  );
};

const ImageView: React.FC<{ scene: ImageScene; plan: EditPlan; look: Look; frames: number; opening?: boolean }> = ({ scene, plan, look, frames, opening }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, frames], [0, 1]);
  const m = scene.motion;
  const scale = m === "zoomOut" ? 1.18 - p * 0.13 : m === "zoomIn" ? 1.05 + p * 0.13 : 1.15;
  const tx = m === "panLeft" ? 4 - p * 8 : m === "panRight" ? -4 + p * 8 : 0;
  const corr = useCorrection(scene.grade);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {corr.defs}
      <Graded look={look} correction={corr.filter}>
        <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${tx}%)` }}>
          {/* Fills the frame like clips do; a portrait photo is cropped toward its upper third, where faces usually are. */}
          <Img src={resolveAsset(plan, scene.src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: framing(scene, "50% 35%") }} />
        </AbsoluteFill>
      </Graded>
      {scene.caption ? <Caption text={scene.caption} look={look} durationInFrames={frames} /> : null}
      {scene.chip ? <TimeChip text={scene.chip} look={look} frames={frames} /> : null}
      {opening ? <OpeningTitle plan={plan} look={look} frames={frames} /> : null}
    </AbsoluteFill>
  );
};

type Backdrop = { scene: VideoScene | ImageScene; trimStart: number };

/**
 * Footage for the title's backdrop. Never scene 1 (the first shot would otherwise play twice in the opening
 * seconds), and never footage any scene plays: prefer a video from the middle of the reel with a different
 * clip, playing a stretch of it that no scene uses; then a photo; then any other scene.
 */
export function pickIntroBackdrop(plan: EditPlan): Backdrop | undefined {
  const first = plan.scenes[0];
  const firstSrc = first && first.kind !== "card" ? first.src : undefined;
  const mid = (plan.scenes.length - 1) / 2;
  const byMiddle = <T extends { i: number }>(list: T[]) => [...list].sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid));
  const indexed = plan.scenes.map((s, i) => ({ s, i })).filter(({ i }) => i > 0);
  const videos = indexed.filter((x): x is { s: VideoScene; i: number } => x.s.kind === "video");
  const images = indexed.filter((x): x is { s: ImageScene; i: number } => x.s.kind === "image");
  // Stretches of each clip that some scene plays, in source seconds.
  const usedBySrc = new Map<string, [number, number][]>();
  for (const s of plan.scenes) if (s.kind === "video") usedBySrc.set(s.src, [...(usedBySrc.get(s.src) ?? []), [s.trimStart, s.trimStart + s.duration * s.speed]]);
  const freeStart = (v: VideoScene): number | undefined => {
    const need = plan.intro.duration * v.speed + 0.1;
    const used = [...(usedBySrc.get(v.src) ?? [])].sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of [...used, [v.sourceDuration, v.sourceDuration] as [number, number]]) {
      if (a - at >= need) return at;
      at = Math.max(at, b);
    }
    return undefined;
  };
  for (const { s } of [...byMiddle(videos.filter((x) => x.s.src !== firstSrc)), ...byMiddle(videos)]) {
    const t = freeStart(s);
    if (t !== undefined) return { scene: s, trimStart: t };
  }
  const pick: VideoScene | ImageScene | undefined =
    byMiddle(images.filter((x) => x.s.src !== firstSrc)).at(0)?.s ?? byMiddle(videos.filter((x) => x.s.src !== firstSrc)).at(0)?.s ?? byMiddle(videos).at(0)?.s ?? byMiddle(images).at(0)?.s;
  if (!pick) return undefined;
  if (pick.kind === "image") return { scene: pick, trimStart: 0 };
  const used = pick.duration * pick.speed;
  const need = plan.intro.duration * pick.speed;
  const after = pick.trimStart + used;
  const trimStart = after + need <= pick.sourceDuration ? after : pick.trimStart >= need ? pick.trimStart - need : pick.trimStart;
  return { scene: pick, trimStart };
}

/** Title over footage: a different shot plays darkened behind it. */
const IntroView: React.FC<{ plan: EditPlan; look: Look; backdrop: Backdrop; frames: number }> = ({ plan, look, backdrop, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = look.unit;
  const line = spring({ frame: frame - 10, fps, config: { damping: 20 } });
  const elegant = look.style.id === "elegant";
  const over = elegant ? "flat" : "footage";
  const b = backdrop.scene;
  const corr = useCorrection(b.grade);
  return (
    <AbsoluteFill>
      {corr.defs}
      <AbsoluteFill style={{ filter: `${corr.filter} blur(6px) brightness(0.45)`, transform: `scale(${1.08 + (frame / frames) * 0.04})` }}>
        {b.kind === "video" ? (
          <OffthreadVideo src={resolveAsset(plan, b.src)} trimBefore={Math.round(backdrop.trimStart * fps)} muted pauseWhenBuffering style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Img src={resolveAsset(plan, b.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </AbsoluteFill>
      {elegant ? <AbsoluteFill style={{ background: `${look.palette.bg}cc` }} /> : null}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: u * 0.08, gap: u * 0.03 }}>
        <span
          style={{
            fontFamily: look.body,
            fontSize: u * 0.036,
            letterSpacing: u * 0.008,
            color: elegant ? look.accentInk : look.palette.accent,
            opacity: line,
            fontWeight: look.bodyStrongWeight,
            textAlign: "center",
            textShadow: textShadow(look, over, u * 0.036),
          }}
        >
          {plan.occasion.toUpperCase()}
        </span>
        <AnimatedHeading text={plan.title} look={look} size={u * (plan.title.length > 22 ? 0.09 : 0.13)} delay={6} durationInFrames={frames} over={over} />
        <div style={{ width: u * 0.18 * line, height: u * 0.006, background: look.palette.accent, borderRadius: 4 }} />
        {plan.subtitle ? <BodyText text={plan.subtitle} look={look} size={u * 0.046} delay={22} over={over} opacity={0.92} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const OutroView: React.FC<{ plan: EditPlan; look: Look; frames: number; startFrame: number }> = ({ plan, look, frames, startFrame }) => {
  const frame = useCurrentFrame();
  const u = look.unit;
  if (plan.outro.backdrop) return <BackdropOutro plan={plan} look={look} frames={frames} />;
  return (
    <AbsoluteFill>
      <MotionField look={look} globalFrame={startFrame + frame} bpm={plan.music?.bpm} variant={3} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: u * 0.04, padding: u * 0.08, transform: `scale(${1 + (frame / frames) * 0.03})` }}>
        <AnimatedHeading text={plan.outro.text} look={look} size={u * 0.095} durationInFrames={frames} />
        <BodyText text={plan.title} look={look} size={u * 0.046} delay={16} color={look.accentInk} weight={look.bodyStrongWeight} opacity={1} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Soundtrack. When the track is shorter than the video it is repeated with a ~1 s equal-power crossfade at
 * each seam instead of an abrupt restart; the whole mix fades in at the start and out at the end.
 */
const Music: React.FC<{ plan: EditPlan; total: number }> = ({ plan, total }) => {
  const { fps } = useVideoConfig();
  const music = plan.music!;
  const src = resolveAsset(plan, music.src);
  // Down by DUCK_DB wherever a clip's speech is lifted, with short ramps either side.
  const talk = React.useMemo(() => speechTimeline(plan), [plan]);
  const fadeIn = Math.max(1, Math.min(fps * 0.5, Math.floor(total / 4)));
  const fadeOut = Math.max(1, Math.min(fps * 2, Math.floor(total / 4)));
  const envelope = (globalFrame: number) =>
    musicDuck(globalFrame, talk, fps) *
    (total < 8
      ? music.volume
      : music.volume * interpolate(globalFrame, [0, fadeIn, total - fadeOut, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  if (!music.duration) return <Audio src={src} loop volume={envelope} />;
  const track = Math.floor(music.duration * fps);
  if (track >= total) return <Audio src={src} volume={envelope} />;

  // Each repeat starts a whole number of beats after the last, so the beat grid (which cards animate to)
  // carries on through the seam; the overlap left over (about 1 s) is the crossfade.
  const beat = music.bpm ? (60 / music.bpm) * fps : 0;
  const onGrid = beat ? Math.round(Math.floor((track - fps * 0.8) / beat) * beat) : 0;
  const step = onGrid > track / 2 ? onGrid : track - Math.min(fps, Math.floor(track / 4));
  const xfade = track - step;
  const copies = Math.ceil((total - xfade) / step);
  return (
    <>
      {Array.from({ length: copies }, (_, k) => {
        const from = k * step;
        const length = Math.min(track, total - from);
        const isFirst = k === 0;
        const isLast = k === copies - 1;
        return (
          <Sequence key={k} from={from} durationInFrames={length} layout="none" name={`music-${k + 1}`}>
            <Audio
              src={src}
              volume={(f) => {
                const gainIn = isFirst ? 1 : Math.sin((Math.min(1, f / xfade) * Math.PI) / 2);
                const out = isLast ? 1 : Math.cos((Math.max(0, Math.min(1, (f - (track - xfade)) / xfade)) * Math.PI) / 2);
                return envelope(from + f) * gainIn * out;
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
};

export const Reel: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  const { width, height } = useVideoConfig();
  const look = makeLook(plan, width, height);
  const segs = timelineSegments(plan);
  const total = planDurationInFrames(plan);
  const backdrop = pickIntroBackdrop(plan);
  // Footage-free videos get product-film titles and branded card chrome.
  const motionOnly = plan.scenes.every((s) => s.kind === "card");
  const cards = plan.scenes.filter((s) => s.kind === "card");

  const items: React.ReactNode[] = [];
  let start = 0;
  segs.forEach((seg, i) => {
    if (i > 0) {
      const tf = transitionFrames(plan, segs[i - 1].frames, seg.frames);
      start += segs[i - 1].frames - tf;
      if (tf > 0) {
        items.push(
          <TransitionSeries.Transition key={`t-${seg.key}`} presentation={presentationFor(plan, i, width, height)} timing={linearTiming({ durationInFrames: tf })} />,
        );
      }
    }
    const sceneIndex = plan.scenes.findIndex((s) => s.id === seg.key);
    const scene = plan.scenes[sceneIndex];
    const opening = !!plan.opening && sceneIndex === 0 && plan.intro.duration === 0;
    let body: React.ReactNode;
    if (seg.key === "intro") {
      body =
        motionOnly || !backdrop ? <MotionIntro plan={plan} look={look} frames={seg.frames} /> : <IntroView plan={plan} look={look} backdrop={backdrop} frames={seg.frames} />;
    } else if (seg.key === "outro") {
      body = motionOnly ? (
        <MotionOutro plan={plan} look={look} frames={seg.frames} startFrame={start} />
      ) : (
        <OutroView plan={plan} look={look} frames={seg.frames} startFrame={start} />
      );
    } else if (scene.kind === "video") {
      // Fade the clip's sound over the transitions it shares with its neighbours.
      const edges = {
        in: i > 0 ? transitionFrames(plan, segs[i - 1].frames, seg.frames) : 0,
        out: i < segs.length - 1 ? transitionFrames(plan, seg.frames, segs[i + 1].frames) : 0,
      };
      body = <VideoView scene={scene} plan={plan} look={look} frames={seg.frames} edges={edges} opening={opening} />;
    } else if (scene.kind === "image") {
      body = <ImageView scene={scene} plan={plan} look={look} frames={seg.frames} opening={opening} />;
    } else {
      body = (
        <CardView scene={scene} plan={plan} look={look} index={cards.indexOf(scene)} total={cards.length} frames={seg.frames} startFrame={start} branded={motionOnly} />
      );
    }
    items.push(
      <TransitionSeries.Sequence key={seg.key} durationInFrames={seg.frames} name={seg.key}>
        {body}
      </TransitionSeries.Sequence>,
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: plan.palette.bg }}>
      <TransitionSeries>{items}</TransitionSeries>
      <Overlays look={look} />
      {plan.music ? <Music plan={plan} total={total} /> : null}
    </AbsoluteFill>
  );
};
