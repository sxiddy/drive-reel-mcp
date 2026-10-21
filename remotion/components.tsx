import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue, EditPlan, Grade } from "../shared/plan";
import { getStyle, type FontKey, type StyleDef } from "../shared/styles";
import { isLight, readableOn, rgba } from "./color";
import { FONTS } from "./fonts";

export type Look = {
  style: StyleDef;
  palette: EditPlan["palette"];
  heading: string;
  body: string;
  /** Short edge of the frame; type is sized from it so 9:16 and 16:9 both work. */
  unit: number;
  aspect: EditPlan["aspect"];
  /** Accent nudged until it is readable as text on the background. */
  accentInk: string;
  /** True for light palettes (elegant, playful), where text needs no dark shadow. */
  light: boolean;
  headingWeight: number;
  bodyWeight: number;
  bodyStrongWeight: number;
  /** Multiplier for heading sizes so wide faces (Orbitron, tracked capitals) and narrow ones (Anton) fill the same space. */
  headingScale: number;
};

// Only weights that fonts.ts actually loads, so the browser never fakes a bold.
const HEADING_WEIGHT: Record<FontKey, number> = {
  Anton: 400,
  BebasNeue: 400,
  Caveat: 700,
  CormorantGaramond: 600,
  Fredoka: 700,
  Inter: 800,
  Montserrat: 600,
  Orbitron: 800,
  PlayfairDisplay: 800,
  SpaceGrotesk: 600,
};
const BODY_WEIGHTS: Record<FontKey, [number, number]> = {
  Anton: [400, 400],
  BebasNeue: [400, 400],
  Caveat: [500, 700],
  CormorantGaramond: [400, 600],
  Fredoka: [500, 700],
  Inter: [400, 600],
  Montserrat: [400, 600],
  Orbitron: [600, 800],
  PlayfairDisplay: [600, 800],
  SpaceGrotesk: [400, 600],
};

// Average glyph width relative to Inter, so headings can be sized by the space they take up.
const FONT_WIDTH: Record<FontKey, number> = {
  Anton: 0.8,
  BebasNeue: 0.75,
  Caveat: 0.85,
  CormorantGaramond: 0.92,
  Fredoka: 1.02,
  Inter: 1,
  Montserrat: 1.1,
  Orbitron: 1.15,
  PlayfairDisplay: 1.05,
  SpaceGrotesk: 1,
};

function headingScale(style: StyleDef) {
  const width = FONT_WIDTH[style.headingFont] * (style.headingCase === "upper" ? 1.1 : 1) * (style.textAnimation === "fade" ? 1.06 : 1);
  return Math.max(0.75, Math.min(1.12, 1 / width));
}

export function makeLook(plan: EditPlan, width: number, height: number): Look {
  const style = getStyle(plan.styleId);
  const { bg, fg, accent } = plan.palette;
  return {
    style,
    palette: plan.palette,
    heading: FONTS[style.headingFont],
    body: FONTS[style.bodyFont],
    unit: Math.min(width, height),
    aspect: plan.aspect,
    accentInk: readableOn(accent, bg, fg),
    light: isLight(bg),
    headingWeight: HEADING_WEIGHT[style.headingFont],
    bodyWeight: BODY_WEIGHTS[style.bodyFont][0],
    bodyStrongWeight: BODY_WEIGHTS[style.bodyFont][1],
    headingScale: headingScale(style),
  };
}

/** Text shadow that keeps type readable over footage, or a soft lift on flat backgrounds. */
export function textShadow(look: Look, over: "footage" | "flat", size: number) {
  if (over === "footage") return `0 ${size * 0.03}px ${size * 0.25}px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.45)`;
  return look.light ? "none" : `0 ${size * 0.04}px ${size * 0.3}px ${rgba(look.palette.bg, 0.6)}`;
}

const casing = (text: string, look: Look) => (look.style.headingCase === "upper" ? text.toUpperCase() : text);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Frames each word waits after the previous one. */
export const wordStagger = (look: Look) => (look.style.textAnimation === "slam" ? 3 : look.style.textAnimation === "fade" ? 5 : 4);

/** How long a heading takes to finish revealing, so body copy can follow it. */
export function headingRevealFrames(text: string, look: Look, durationInFrames?: number) {
  if (look.style.textAnimation === "type") return typeFrames(text, durationInFrames);
  const words = text.split(/\s+/).filter(Boolean).length;
  return (words - 1) * wordStagger(look) + (look.style.textAnimation === "fade" ? 22 : 14);
}

/** Typing speed: about 1.6 frames per character, but always done within ~45% of the scene. */
function typeFrames(text: string, durationInFrames?: number) {
  const natural = Math.max(12, text.length * 1.6);
  return durationInFrames ? Math.max(10, Math.min(natural, durationInFrames * 0.45)) : natural;
}

/**
 * Kinetic heading, revealed word by word with the style's text animation:
 * rise = words slide up out of a mask, slam = punch in with a shake, pop = bouncy scale,
 * fade = slow tracked-out fade, glitch = RGB split jitter, type = typewriter.
 */
export const AnimatedHeading: React.FC<{
  text: string;
  look: Look;
  size: number;
  delay?: number;
  color?: string;
  align?: "center" | "left";
  /** Word indexes drawn in the accent colour ("last" = the final word). */
  highlight?: number[] | "last";
  maxWidth?: number | string;
  /** Scene length, so the typewriter always finishes (and its cursor goes away) in time. */
  durationInFrames?: number;
  over?: "footage" | "flat";
  lineHeight?: number;
}> = ({ text, look, size: requested, delay = 0, color, align = "center", highlight, maxWidth, durationInFrames, over = "flat", lineHeight = 1.06 }) => {
  const size = requested * look.headingScale;
  const frame = useCurrentFrame() - delay;
  const { fps } = useVideoConfig();
  const anim = look.style.textAnimation;
  const cased = casing(text, look);
  const words = cased.split(/\s+/).filter(Boolean);
  const fg = color ?? look.palette.fg;
  const glow = look.style.overlay.glow
    ? `0 0 ${size * 0.1}px ${rgba(look.palette.accent, 0.9)}, 0 0 ${size * 0.3}px ${rgba(look.palette.accent, 0.55)}`
    : textShadow(look, over, size);
  const hl = new Set(highlight === "last" ? [words.length - 1] : (highlight ?? []));

  const base: React.CSSProperties = {
    fontFamily: look.heading,
    fontSize: size,
    lineHeight,
    color: fg,
    textAlign: align,
    fontWeight: look.headingWeight,
    letterSpacing: anim === "fade" ? size * 0.06 : look.style.headingFont === "Inter" ? -size * 0.025 : 0,
    textShadow: glow,
    margin: 0,
    maxWidth,
    textWrap: "balance",
  };

  if (anim === "type") {
    const tf = typeFrames(cased, durationInFrames);
    const chars = Math.floor(interpolate(frame, [0, tf], [0, cased.length], clamp));
    // Solid while typing, two blinks after, then gone for good.
    const after = frame - tf;
    const cursorOn = frame >= 0 && (after < 0 || (after < 18 && Math.floor(after / 5) % 2 === 1));
    return (
      <h1 style={base}>
        <span>{cased.slice(0, chars)}</span>
        <span style={{ position: "relative", display: "inline-block", width: 0 }}>
          <span style={{ position: "absolute", left: size * 0.02, bottom: -size * 0.05, opacity: cursorOn ? 1 : 0, color: look.accentInk, fontWeight: 500 }}>|</span>
        </span>
        <span style={{ opacity: 0 }}>{cased.slice(chars)}</span>
      </h1>
    );
  }

  const stagger = wordStagger(look);
  return (
    <h1 style={base}>
      {words.map((w, i) => {
        const f = frame - i * stagger;
        const wordColor = hl.has(i) ? look.accentInk : undefined;
        if (anim === "rise") {
          const s = spring({ frame: f, fps, config: { damping: 200, stiffness: 140, mass: 0.7 } });
          const done = s > 0.995;
          return (
            <React.Fragment key={i}>
              <span
                style={{
                  display: "inline-block",
                  verticalAlign: "top",
                  // Clip only below the line while the word rises, then let its shadow breathe.
                  clipPath: done ? undefined : "inset(-50% -20% 0 -20%)",
                  paddingBottom: size * 0.16,
                  marginBottom: -size * 0.16,
                }}
              >
                <span style={{ display: "inline-block", transform: `translateY(${(1 - s) * 112}%)`, color: wordColor }}>{w}</span>
              </span>
              {i < words.length - 1 ? " " : null}
            </React.Fragment>
          );
        }
        const s = spring({ frame: f, fps, config: anim === "pop" ? { damping: 9, stiffness: 160 } : { damping: 18, stiffness: 120 } });
        let transform = "";
        let opacity = interpolate(f, [0, 6], [0, 1], clamp);
        let shadow: string | undefined;
        if (anim === "slam") {
          const k = interpolate(f, [0, 5], [1.8, 1], clamp);
          const shake = f > 4 && f < 10 ? (random(`s${i}${f}`) - 0.5) * size * 0.05 : 0;
          transform = `scale(${k}) translateX(${shake}px)`;
        }
        if (anim === "pop") transform = `scale(${s}) rotate(${(1 - s) * (i % 2 ? 8 : -8)}deg)`;
        if (anim === "fade") {
          opacity = interpolate(f, [0, 22], [0, 1], clamp);
          transform = `translateY(${interpolate(f, [0, 22], [size * 0.12, 0], clamp)}px)`;
        }
        if (anim === "glitch") {
          const glitching = f < 14;
          opacity = glitching ? (random(`g${i}${f}`) > 0.35 ? 1 : 0.2) * (f >= 0 ? 1 : 0) : 1;
          const dx = glitching ? (random(`x${i}${f}`) - 0.5) * size * 0.12 : 0;
          transform = `translateX(${dx}px)`;
          shadow = glitching ? `${size * 0.04}px 0 #00e5ff, ${-size * 0.04}px 0 ${look.palette.accent}` : undefined;
        }
        return (
          <React.Fragment key={i}>
            <span style={{ display: "inline-block", transform, opacity, textShadow: shadow ?? glow, color: wordColor }}>{w}</span>
            {i < words.length - 1 ? " " : null}
          </React.Fragment>
        );
      })}
    </h1>
  );
};

/** Fade-in body text. */
export const BodyText: React.FC<{
  text: string;
  look: Look;
  size: number;
  delay?: number;
  color?: string;
  align?: "center" | "left";
  over?: "footage" | "flat";
  maxWidth?: number | string;
  weight?: number;
  opacity?: number;
}> = ({ text, look, size, delay = 0, color, align = "center", over = "flat", maxWidth, weight, opacity: maxOpacity = 0.86 }) => {
  const frame = useCurrentFrame() - delay;
  const opacity = interpolate(frame, [0, 14], [0, 1], clamp);
  const y = interpolate(frame, [0, 14], [size * 0.8, 0], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  return (
    <p
      style={{
        fontFamily: look.body,
        fontSize: size,
        lineHeight: 1.4,
        color: color ?? look.palette.fg,
        opacity: opacity * maxOpacity,
        transform: `translateY(${y}px)`,
        textAlign: align,
        margin: 0,
        fontWeight: weight ?? look.bodyWeight,
        textShadow: textShadow(look, over, size),
        maxWidth,
        textWrap: "pretty",
      }}
    >
      {text}
    </p>
  );
};

const LUMA_709 = [0.2126, 0.7152, 0.0722];

/**
 * The shot's colour correction (white balance, exposure gamma, saturation; see Grade in shared/plan) as an
 * SVG filter. Returns the CSS filter that references it (empty when there is none) and the <svg> holding it,
 * which must be rendered in the same document. Works in the renderer and in the editor's Player.
 */
export function useCorrection(grade: Grade | undefined): { filter: string; defs: React.ReactNode } {
  const id = `grade-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!grade) return { filter: "", defs: null };
  const { gain, gamma, saturation: k } = grade;
  // Saturation about Rec.709 luma: c' = Y + k·(c − Y).
  const row = (c: number) => LUMA_709.map((w, j) => (1 - k) * w + (j === c ? k : 0)).concat(0, 0).map((x) => x.toFixed(4)).join(" ");
  const matrix = [row(0), row(1), row(2), "0 0 0 1 0"].join(" ");
  const fn = (g: number) => ({ type: "gamma" as const, amplitude: Number((g ** gamma).toFixed(4)), exponent: Number(gamma.toFixed(4)), offset: 0 });
  const defs = (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        {/* (gain·c)^γ = gain^γ · c^γ: white balance and exposure in one pass. */}
        <feComponentTransfer>
          <feFuncR {...fn(gain[0])} />
          <feFuncG {...fn(gain[1])} />
          <feFuncB {...fn(gain[2])} />
        </feComponentTransfer>
        <feColorMatrix type="matrix" values={matrix} />
      </filter>
    </svg>
  );
  return { filter: `url(#${id})`, defs };
}

/**
 * Colour grade for footage: the shot's own correction first (so every clip starts from the same place),
 * then the style's CSS filter and optional blended wash, the same for every shot.
 */
export const Graded: React.FC<{ look: Look; children: React.ReactNode; correction?: string }> = ({ look, children, correction }) => {
  const { wash, grade } = look.style;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: [correction, grade].filter(Boolean).join(" ") }}>{children}</AbsoluteFill>
      {wash ? <AbsoluteFill style={{ background: wash.color, mixBlendMode: wash.blend, opacity: wash.opacity }} /> : null}
    </AbsoluteFill>
  );
};

/** Film grain, vignette and letterbox that sit over the whole video. */
export const Overlays: React.FC<{ look: Look }> = ({ look }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const { grain, vignette, letterbox } = look.style.overlay;
  const seed = Math.floor(frame / 2) % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {vignette ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${vignette}) 100%)` }} />
      ) : null}
      {grain ? (
        <AbsoluteFill style={{ opacity: grain, mixBlendMode: "overlay" }}>
          <svg width="100%" height="100%">
            <filter id={`grain${seed}`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
          </svg>
        </AbsoluteFill>
      ) : null}
      {letterbox && look.aspect === "16:9" ? (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: height * 0.1, background: "#000" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: height * 0.1, background: "#000" }} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

/** Where the lower-third sits: its bottom offset, font size and box height. Shared with Subtitles so they never collide. */
function captionMetrics(look: Look, height: number) {
  const size = look.unit * 0.044;
  const bottom = look.style.overlay.letterbox && look.aspect === "16:9" ? height * 0.14 : height * (look.aspect === "9:16" ? 0.16 : 0.08);
  const handwritten = look.style.textAnimation === "type";
  const boxed = look.style.id === "clean" || look.style.id === "playful";
  // One line of text (line-height ~1.25) plus the box padding.
  const block = size * (handwritten ? 1.3 : 1) * 1.25 + (boxed ? size * 0.7 : 0);
  return { size, bottom, handwritten, boxed, block };
}

/** Lower-third caption over footage. */
export const Caption: React.FC<{ text: string; look: Look; durationInFrames: number }> = ({ text, look, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 20 } });
  const exit = interpolate(frame, [durationInFrames - 10, durationInFrames - 2], [1, 0], clamp);
  const { size, bottom, handwritten, boxed } = captionMetrics(look, height);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: look.style.id === "clean" ? "flex-start" : "center", padding: `0 ${look.unit * 0.07}px`, paddingBottom: bottom }}>
      <div
        style={{
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * size}px)`,
          display: "flex",
          alignItems: "center",
          gap: size * 0.5,
          background: boxed ? rgba(look.palette.bg, 0.9) : "transparent",
          padding: boxed ? `${size * 0.35}px ${size * 0.6}px` : 0,
          borderRadius: look.style.id === "playful" ? size : size * 0.15,
        }}
      >
        {look.style.id === "clean" ? <div style={{ width: size * 0.18, alignSelf: "stretch", background: look.palette.accent }} /> : null}
        <span
          style={{
            fontFamily: handwritten ? look.heading : look.body,
            fontSize: handwritten ? size * 1.3 : size,
            color: boxed ? look.palette.fg : "#fff",
            fontWeight: handwritten ? 700 : look.bodyStrongWeight,
            letterSpacing: look.style.id === "elegant" ? size * 0.12 : 0,
            textTransform: look.style.id === "elegant" || look.style.id === "hype" ? "uppercase" : "none",
            textShadow: look.style.overlay.glow ? `0 0 12px ${look.palette.accent}, 0 2px 10px rgba(0,0,0,0.6)` : boxed ? "none" : "0 2px 16px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.5)",
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Seconds a subtitle takes to fade in and out. */
const CUE_FADE = 0.18;

/**
 * Subtitles for what is said in a shot. Cues are timed in the source clip, so the shot's trim and speed map
 * them onto the timeline. Readable first: the style's body font in its strongest loaded weight, its
 * foreground colour on a translucent panel of its background colour, at most two balanced lines, inside the
 * safe area for 16:9, 9:16 and 1:1, and stacked above the lower-third caption when there is one.
 */
export const Subtitles: React.FC<{
  cues: CaptionCue[];
  look: Look;
  trimStart: number;
  speed: number;
  durationInFrames: number;
  /** A lower-third caption is on screen too. */
  aboveCaption: boolean;
}> = ({ cues, look, trimStart, speed, durationInFrames, aboveCaption }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = trimStart + (frame / fps) * speed;
  const cue = cues.filter((c) => t >= c.start && t <= c.end).sort((a, b) => b.start - a.start)[0];
  if (!cue) return null;
  const unit = (x: number) => Math.max(0, Math.min(1, x));
  const edge = Math.max(1, Math.round(CUE_FADE * fps));
  const opacity = Math.min(unit((t - cue.start) / CUE_FADE), unit((cue.end - t) / CUE_FADE), unit(frame / edge), unit((durationInFrames - frame) / edge));
  const cap = captionMetrics(look, height);
  const size = look.unit * 0.04;
  const bottom = cap.bottom + (aboveCaption ? cap.block + cap.size * 0.6 : 0);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: bottom, pointerEvents: "none" }}>
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - opacity) * size * 0.25}px)`,
          maxWidth: width * (look.aspect === "16:9" ? 0.76 : 0.86),
          background: rgba(look.palette.bg, 0.72),
          borderRadius: Math.min(size * 0.45, look.style.graphics.radius * look.unit + size * 0.15),
          padding: `${size * 0.22}px ${size * 0.5}px`,
        }}
      >
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontFamily: look.body,
            fontSize: size,
            lineHeight: 1.3,
            fontWeight: look.bodyStrongWeight,
            color: look.palette.fg,
            textAlign: "center",
            textWrap: "balance",
          }}
        >
          {cue.text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Animated abstract background (soft blobs). Kept for compatibility; cards now use MotionField. */
export const ShapeBackground: React.FC<{ look: Look; seed: string }> = ({ look, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { bg, accent, fg } = look.palette;
  const id = look.style.id;
  const t = frame / 30;
  const blobs = [0, 1, 2].map((i) => {
    const x = (random(`${seed}x${i}`) * 0.8 + 0.1) * width + Math.sin(t * 0.6 + i * 2) * width * 0.05;
    const y = (random(`${seed}y${i}`) * 0.8 + 0.1) * height + Math.cos(t * 0.5 + i) * height * 0.05;
    const r = look.unit * (0.35 + random(`${seed}r${i}`) * 0.35);
    return { x, y, r, color: i === 1 ? fg : accent };
  });
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x - b.r,
            top: b.y - b.r,
            width: b.r * 2,
            height: b.r * 2,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${rgba(b.color, id === "elegant" ? 0.08 : 0.2)} 0%, ${rgba(b.color, 0)} 70%)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
