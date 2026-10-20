import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset, type CardScene, type EditPlan } from "../shared/plan";
import { mix, rgba } from "./color";
import { AnimatedHeading, BodyText, headingRevealFrames, textShadow, type Look } from "./components";
import { Icon } from "./icons";
import { BrandLockup, Kicker, LogoMark, MotionField, ProgressBadge, beatFrames, beatPulse, clamp, easeOutCubic, easeOutExpo } from "./motion";

export type CardLayout = NonNullable<CardScene["layout"]>;

/** The layout a card uses: its own, or the one its fields suggest. */
export function cardLayout(scene: CardScene): CardLayout {
  if (scene.layout) return scene.layout;
  if (scene.stat) return "stat";
  if (scene.image) return "screenshot";
  if (scene.bullets?.length) return "bullets";
  if (scene.icon) return "feature";
  if (/^\s*["“”'‘’«„]/.test(scene.heading)) return "quote";
  return "statement";
}

type Frame = { width: number; height: number; u: number; portrait: boolean; square: boolean; padX: number; /** Type scale: square frames have less room around the copy. */ k: number };

function useFrameGeometry(look: Look): Frame {
  const { width, height } = useVideoConfig();
  const u = look.unit;
  const portrait = height > width * 1.2;
  const square = !portrait && width < height * 1.2;
  return { width, height, u, portrait, square, padX: portrait ? width * 0.08 : width * (square ? 0.08 : 0.085), k: square ? 0.8 : 1 };
}

/** Heading size that shrinks with length so long headings keep to three or four lines. */
const headingSize = (text: string, u: number, big = 0.115) => u * (text.length <= 18 ? big : text.length <= 34 ? big * 0.84 : text.length <= 52 ? big * 0.72 : big * 0.62);

type CardProps = {
  scene: CardScene;
  plan: EditPlan;
  look: Look;
  /** Position among the plan's cards and how many there are, for the "02 / 07" badge. */
  index: number;
  total: number;
  frames: number;
  /** Where this scene starts on the whole timeline, so backgrounds flow on and beats line up. */
  startFrame: number;
  /** Product-film chrome (brand lockup in the corner) for footage-free videos. */
  branded: boolean;
};

type LayoutProps = CardProps & { geo: Frame };

/** Motion-graphics card: a living backdrop, a layout-specific composition, camera drift, progress chrome and a quick exit. */
export const CardView: React.FC<CardProps> = (props) => {
  const { scene, plan, look, index, total, frames, startFrame, branded } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const geo = useFrameGeometry(look);
  const { u, padX } = geo;
  const layout = cardLayout(scene);

  // Slow camera drift so no two frames are the same, plus a quick lift-and-fade out in the last frames.
  const drift = interpolate(frame, [0, frames], [1, 1.04], clamp);
  const exit = interpolate(frame, [frames - 9, frames - 1], [0, 1], { ...clamp, easing: (t) => t * t });
  const chromeIn = spring({ frame: frame - 2, fps, config: { damping: 200 } });

  const Layout = LAYOUTS[layout];
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1.02 + (drift - 1) * 0.5})` }}>
        <MotionField look={look} globalFrame={startFrame + frame} bpm={plan.music?.bpm} variant={index} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(${drift}) translateY(${-exit * u * 0.03}px)`,
          opacity: 1 - exit,
          padding: `${u * 0.15}px ${padX}px ${u * 0.12}px`,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Layout {...props} geo={geo} />
      </AbsoluteFill>
      {/* Chrome sits outside the camera move so it reads like a steady UI layer. */}
      <div
        style={{
          position: "absolute",
          // Below the letterbox bars when the style has them.
          top: look.style.overlay.letterbox && look.aspect === "16:9" ? geo.height * 0.1 + u * 0.035 : u * 0.055,
          left: padX,
          right: padX,
          display: "flex",
          justifyContent: branded ? "space-between" : "flex-end",
          alignItems: "flex-start",
          opacity: chromeIn * (1 - exit * 0.6),
        }}
      >
        {branded ? <BrandLockup look={look} title={plan.title} size={u * 0.03} /> : null}
        <ProgressBadge look={look} index={index} total={total} progress={frame / frames} size={u * 0.03} />
      </div>
    </AbsoluteFill>
  );
};

// ─── statement ──────────────────────────────────────────────────────────────

const Statement: React.FC<LayoutProps> = ({ scene, look, frames, geo }) => {
  const frame = useCurrentFrame();
  const { u, portrait, width } = geo;
  const size = headingSize(scene.heading, u * geo.k, portrait ? 0.13 : 0.135);
  const start = scene.kicker ? 8 : 3;
  const reveal = headingRevealFrames(scene.heading, look, frames);
  const bar = easeOutCubic(interpolate(frame, [start + reveal - 6, start + reveal + 14], [0, 1], clamp));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u * 0.04, maxWidth: portrait ? "100%" : width * 0.78 }}>
      {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.03} /> : null}
      <AnimatedHeading text={scene.heading} look={look} size={size} delay={start} highlight="last" durationInFrames={frames} />
      <div style={{ width: u * 0.16 * bar, height: Math.max(4, u * 0.007), borderRadius: u, background: `linear-gradient(90deg, ${look.palette.accent}, ${look.style.graphics.secondary})` }} />
      {scene.body ? <BodyText text={scene.body} look={look} size={u * (portrait ? 0.045 : 0.04)} delay={start + reveal + 2} maxWidth={u * (portrait ? 0.9 : 1.15)} /> : null}
    </div>
  );
};

// ─── bullets ────────────────────────────────────────────────────────────────

const CheckBadge: React.FC<{ look: Look; size: number; progress: number; pulse: number }> = ({ look, size, progress, pulse }) => {
  const { accent } = look.palette;
  const fill = look.light ? "#ffffff" : look.palette.bg;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${accent}`, transform: `scale(${1 + pulse * 0.9})`, opacity: (1 - pulse) * 0.7 * (pulse > 0 ? 1 : 0) }} />
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", inset: 0, transform: `scale(${0.4 + 0.6 * Math.min(1, progress * 2)})` }}>
        <circle cx={12} cy={12} r={11} fill={accent} opacity={Math.min(1, progress * 3)} />
        <path d="M7 12.4l3.3 3.3L17.2 8.6" fill="none" stroke={fill} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, Math.min(1, progress * 2 - 0.6))} />
      </svg>
    </div>
  );
};

const Bullets: React.FC<LayoutProps> = ({ scene, plan, look, frames, startFrame, geo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, square, width } = geo;
  const items = scene.bullets ?? [];
  const stacked = portrait || square;
  const start = scene.kicker ? 8 : 3;
  const reveal = headingRevealFrames(scene.heading, look, frames);

  // Items land on the music's beat: snap the first to the next beat after the heading, then one per beat
  // (every other beat at fast tempos), squeezed if needed so the last one is up for at least a second.
  const beat = beatFrames(fps, plan.music?.bpm);
  const step0 = beat < fps * 0.4 ? beat * 2 : beat;
  const earliest = startFrame + start + Math.min(reveal, 18) + 4;
  const first = Math.ceil(earliest / beat) * beat - startFrame;
  const room = Math.max(1, frames - fps - first);
  const step = items.length > 1 && step0 * (items.length - 1) > room ? Math.max(4, room / (items.length - 1)) : step0;
  const at = items.map((_, i) => first + i * step);
  const active = at.reduce((a, f, i) => (frame >= f ? i : a), -1);

  const headingBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: u * 0.035, alignItems: "flex-start", flex: stacked ? undefined : "1 1 0", minWidth: 0 }}>
      {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.03} /> : null}
      <AnimatedHeading text={scene.heading} look={look} size={headingSize(scene.heading, u * geo.k, stacked ? 0.115 : 0.115)} delay={start} align="left" durationInFrames={frames} />
      {scene.body ? <BodyText text={scene.body} look={look} size={u * 0.038} delay={start + reveal} align="left" /> : null}
    </div>
  );

  const rowSize = u * (stacked ? 0.046 : 0.042);
  const list = (
    <div style={{ display: "flex", flexDirection: "column", gap: u * 0.022, flex: stacked ? undefined : "1 1 0", width: stacked ? "100%" : undefined, minWidth: 0 }}>
      {items.map((b, i) => {
        const f = frame - at[i];
        const s = spring({ frame: f, fps, config: { damping: 18, stiffness: 170, mass: 0.8 } });
        const check = interpolate(f, [0, 16], [0, 1], clamp);
        const ring = f >= 0 ? interpolate(f, [0, 14], [0, 1], clamp) : 0;
        const isActive = i === active;
        const pulse = isActive ? beatPulse(startFrame + frame, fps, plan.music?.bpm) : 0;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: rowSize * 0.6,
              padding: `${rowSize * 0.55}px ${rowSize * 0.7}px`,
              borderRadius: u * look.style.graphics.radius * 1.2,
              background: isActive ? rgba(look.palette.accent, look.light ? 0.1 : 0.12) : rgba(look.palette.fg, look.light ? 0.05 : 0.06),
              border: `${Math.max(1.5, u * 0.0018)}px solid ${isActive ? rgba(look.palette.accent, 0.6 + pulse * 0.3) : rgba(look.palette.fg, 0.12)}`,
              opacity: Math.min(1, s * 1.4),
              transform: `translateX(${(1 - s) * u * 0.08}px) scale(${0.96 + 0.04 * s})`,
              transformOrigin: "left center",
            }}
          >
            <CheckBadge look={look} size={rowSize * 1.15} progress={check} pulse={ring < 1 ? ring : 0} />
            <span style={{ fontFamily: look.body, fontSize: rowSize, fontWeight: look.bodyStrongWeight, color: look.palette.fg, lineHeight: 1.2, textShadow: textShadow(look, "flat", rowSize) }}>{b}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        gap: stacked ? u * 0.06 : u * 0.12,
        width: stacked ? "100%" : width * 0.83,
      }}
    >
      {headingBlock}
      {list}
    </div>
  );
};

// ─── stat ───────────────────────────────────────────────────────────────────

function formatNumber(n: number, decimals: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const Stat: React.FC<LayoutProps> = ({ scene, look, frames, startFrame, plan, geo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, width, padX } = geo;
  const stat = scene.stat ?? { value: 0, label: "" };
  const decimals = Math.min(2, (String(stat.value).split(".")[1] ?? "").length);
  const countFrom = 10;
  const countLen = Math.min(56, Math.max(20, frames * 0.45));
  const p = easeOutExpo(interpolate(frame, [countFrom, countFrom + countLen], [0, 1], clamp));
  const current = formatNumber(stat.value * p, decimals);
  const final = formatNumber(stat.value, decimals);
  const prefix = stat.prefix ?? "";
  const suffix = stat.suffix ?? "";
  const chars = (prefix + final + suffix).length;
  const avail = width - padX * 2;
  const numSize = look.headingScale * Math.min(u * (portrait ? 0.26 : 0.27), avail / (chars * 0.62));
  const pop = spring({ frame: frame - countFrom - countLen + 4, fps, config: { damping: 10, stiffness: 180 } });
  const settle = frame > countFrom + countLen - 4 ? 1 + 0.035 * Math.sin(Math.min(1, pop) * Math.PI) : 1;
  const line = easeOutCubic(interpolate(frame, [countFrom + 6, countFrom + countLen], [0, 1], clamp));
  const t = (startFrame + frame) / fps;
  // Big enough to frame the whole block (it runs off the frame edges like bracket arcs) without crossing the copy.
  const ringR = Math.max(u * 0.62, (chars * 0.6 * numSize) / 2 + u * 0.08);
  const glow = look.style.overlay.glow ? `0 0 ${numSize * 0.08}px ${rgba(look.palette.accent, 0.9)}, 0 0 ${numSize * 0.25}px ${rgba(look.palette.accent, 0.5)}` : textShadow(look, "flat", numSize);
  const pulse = beatPulse(startFrame + frame, fps, plan.music?.bpm);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: u * 0.02 }}>
      {/* Turning rings behind the number; the accent arc fills with the count. */}
      <svg
        width={ringR * 2.4}
        height={ringR * 2.4}
        viewBox={`${-ringR * 1.2} ${-ringR * 1.2} ${ringR * 2.4} ${ringR * 2.4}`}
        style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) rotate(${(portrait ? -90 : 180) + t * 6}deg)`, overflow: "visible", pointerEvents: "none" }}
      >
        <circle r={ringR} fill="none" stroke={rgba(look.palette.fg, 0.09)} strokeWidth={u * 0.004} />
        <circle r={ringR} fill="none" stroke={look.palette.accent} strokeOpacity={0.7 + pulse * 0.3} strokeWidth={u * 0.006} strokeLinecap="round" pathLength={1} strokeDasharray={`${p * 0.72} 1`} />
        <circle r={ringR * 1.15} fill="none" stroke={rgba(look.style.graphics.secondary, 0.25)} strokeWidth={u * 0.002} strokeDasharray={`${u * 0.004} ${u * 0.018}`} transform={`rotate(${-t * 14})`} />
      </svg>
      {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.03} /> : null}
      {scene.heading ? (
        <div style={{ marginTop: u * 0.015 }}>
          <AnimatedHeading text={scene.heading} look={look} size={u * (portrait ? 0.058 : 0.052)} delay={2} durationInFrames={frames} maxWidth={u * 1.3} />
        </div>
      ) : null}
      <div style={{ position: "relative", fontFamily: look.heading, fontWeight: look.headingWeight, fontSize: numSize, lineHeight: 1, color: look.palette.fg, fontVariantNumeric: "tabular-nums", letterSpacing: look.style.headingFont === "Inter" ? -numSize * 0.04 : 0, textShadow: glow, transform: `scale(${settle})`, whiteSpace: "nowrap", opacity: interpolate(frame, [countFrom - 6, countFrom], [0, 1], clamp) }}>
        {/* The final value reserves the width; the counter is right-aligned inside it so digits roll in like an odometer. */}
        <span style={{ visibility: "hidden" }}>
          {prefix}
          {final}
          {suffix}
        </span>
        <span style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "flex-end" }}>
          <span style={{ color: look.accentInk }}>{prefix}</span>
          <span>{current}</span>
          <span style={{ color: look.accentInk }}>{suffix}</span>
        </span>
      </div>
      <div style={{ width: u * 0.34 * line, height: Math.max(5, u * 0.009), borderRadius: u, background: `linear-gradient(90deg, ${look.palette.accent}, ${look.style.graphics.secondary})`, marginTop: u * 0.005 }} />
      <BodyText text={stat.label} look={look} size={u * (portrait ? 0.05 : 0.044)} delay={countFrom + 14} weight={look.bodyStrongWeight} opacity={0.92} />
      {scene.body ? <BodyText text={scene.body} look={look} size={u * 0.034} delay={countFrom + 24} maxWidth={u * 1.1} opacity={0.78} /> : null}
    </div>
  );
};

// ─── quote ──────────────────────────────────────────────────────────────────

const QuoteMark: React.FC<{ look: Look; size: number }> = ({ look, size }) => (
  <svg width={size} height={size * 0.75} viewBox="0 0 48 36" style={{ display: "block", overflow: "visible" }}>
    <defs>
      <linearGradient id="qgrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={look.palette.accent} />
        <stop offset="1" stopColor={mix(look.palette.accent, look.style.graphics.secondary, 0.7)} />
      </linearGradient>
    </defs>
    <path
      d="M0 36V22C0 9.5 6.4 2.2 19.2 0l2 5.2C14 7.4 10.6 11.6 10.2 18H19v18H0zm27 0V22C27 9.5 33.4 2.2 46.2 0l2 5.2C41 7.4 37.6 11.6 37.2 18H46v18H27z"
      fill="url(#qgrad)"
    />
  </svg>
);

const Quote: React.FC<LayoutProps> = ({ scene, look, frames, geo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, width } = geo;
  const text = scene.heading.replace(/^\s*["“”'‘’«„]+|["“”'‘’»]+\s*$/g, "").trim();
  const size = u * (text.length <= 40 ? (portrait ? 0.09 : 0.095) : text.length <= 70 ? 0.08 : 0.066);
  const mark = spring({ frame, fps, config: { damping: 12, stiffness: 140 } });
  const reveal = headingRevealFrames(text, look, frames);
  const by = 8 + reveal;
  const line = easeOutCubic(interpolate(frame, [by, by + 14], [0, 1], clamp));
  const align = portrait ? "center" : "left";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: portrait ? "center" : "flex-start", gap: u * 0.045, maxWidth: portrait ? "100%" : width * 0.74 }}>
      <div style={{ transform: `scale(${mark}) rotate(${(1 - mark) * -12}deg)`, transformOrigin: "left bottom", opacity: Math.min(1, mark * 2) }}>
        <QuoteMark look={look} size={u * 0.15} />
      </div>
      {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.028} delay={4} /> : null}
      <AnimatedHeading text={text} look={look} size={size} delay={8} align={align} durationInFrames={frames} lineHeight={1.16} />
      {scene.body ? (
        <div style={{ display: "flex", alignItems: "center", gap: u * 0.025 }}>
          <div style={{ width: u * 0.07 * line, height: Math.max(3, u * 0.004), background: look.palette.accent, borderRadius: u }} />
          <BodyText text={scene.body} look={look} size={u * 0.04} delay={by + 4} align="left" weight={look.bodyStrongWeight} opacity={0.9} />
        </div>
      ) : null}
    </div>
  );
};

// ─── feature ────────────────────────────────────────────────────────────────

const IconTile: React.FC<{ look: Look; scene: CardScene; size: number; startFrame: number; bpm?: number }> = ({ look, scene, size, startFrame, bpm }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { accent } = look.palette;
  const secondary = look.style.graphics.secondary;
  const enter = spring({ frame: frame - 2, fps, config: { damping: 14, stiffness: 120 } });
  const draw = easeOutCubic(interpolate(frame, [8, 52], [0, 1], clamp));
  const t = (startFrame + frame) / fps;
  const float = Math.sin(t * 1.4) * size * 0.025;
  const orbit = t * 1.1;
  const pulse = beatPulse(startFrame + frame, fps, bpm);
  const radius = look.style.id === "playful" ? size * 0.32 : Math.max(size * 0.08, look.unit * look.style.graphics.radius * 2.2);
  const ringR = size * 0.74;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, transform: `translateY(${float}px) scale(${0.7 + 0.3 * enter}) rotate(${(1 - enter) * -10}deg)`, opacity: Math.min(1, enter * 1.5) }}>
      {/* Orbit ring with a travelling dot. */}
      <svg width={ringR * 2} height={ringR * 2} viewBox={`${-ringR} ${-ringR} ${ringR * 2} ${ringR * 2}`} style={{ position: "absolute", left: size / 2 - ringR, top: size / 2 - ringR, overflow: "visible" }}>
        <circle r={ringR} fill="none" stroke={rgba(look.palette.fg, 0.1)} strokeWidth={1.5} strokeDasharray={`${size * 0.01} ${size * 0.03}`} />
        <circle cx={Math.cos(orbit) * ringR} cy={Math.sin(orbit) * ringR} r={size * 0.025} fill={accent} />
        <circle cx={Math.cos(orbit + Math.PI) * ringR} cy={Math.sin(orbit + Math.PI) * ringR} r={size * 0.016} fill={secondary} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          background: `linear-gradient(145deg, ${rgba(accent, look.light ? 0.16 : 0.24)} 0%, ${rgba(secondary, look.light ? 0.06 : 0.08)} 100%)`,
          border: `2px solid ${rgba(accent, 0.45 + pulse * 0.25)}`,
          boxShadow: look.light
            ? `0 ${size * 0.06}px ${size * 0.18}px ${rgba(look.palette.fg, 0.12)}`
            : `0 0 ${size * 0.25}px ${rgba(accent, 0.25)}, inset 0 0 ${size * 0.15}px ${rgba(accent, 0.15)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={scene.icon ?? "spark"} size={size * 0.56} color={look.light ? look.accentInk : accent} progress={draw} strokeWidth={1.35} fill={accent} />
      </div>
    </div>
  );
};

const Feature: React.FC<LayoutProps> = ({ scene, plan, look, frames, startFrame, geo }) => {
  const { u, portrait, square, width } = geo;
  const stacked = portrait || square;
  const reveal = headingRevealFrames(scene.heading, look, frames);
  const textStart = 12;
  return (
    <div style={{ display: "flex", flexDirection: stacked ? "column" : "row", alignItems: "center", gap: stacked ? u * 0.09 : u * 0.13, width: stacked ? "100%" : width * 0.8 }}>
      <IconTile look={look} scene={scene} size={u * (portrait ? 0.34 : square ? 0.26 : 0.36)} startFrame={startFrame} bpm={plan.music?.bpm} />
      <div style={{ display: "flex", flexDirection: "column", gap: u * 0.035, alignItems: stacked ? "center" : "flex-start", flex: stacked ? undefined : "1 1 0", minWidth: 0 }}>
        {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.03} delay={6} /> : null}
        <AnimatedHeading text={scene.heading} look={look} size={headingSize(scene.heading, u * geo.k, stacked ? 0.115 : 0.11)} delay={textStart} align={stacked ? "center" : "left"} durationInFrames={frames} />
        {scene.body ? <BodyText text={scene.body} look={look} size={u * (portrait ? 0.044 : 0.04)} delay={textStart + reveal} align={stacked ? "center" : "left"} maxWidth={u * 1.1} /> : null}
      </div>
    </div>
  );
};

// ─── screenshot ─────────────────────────────────────────────────────────────

const ScreenContent: React.FC<{ src?: string; look: Look; glare: number }> = ({ src, look, glare }) => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0b0d12" }}>
    {src ? (
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", display: "block" }} />
    ) : (
      // No image: a tasteful skeleton UI instead of an empty screen.
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${mix(look.palette.bg, look.palette.accent, 0.25)}, ${look.palette.bg})`, padding: "8%", display: "flex", flexDirection: "column", gap: "5%" }}>
        {[0.6, 0.9, 0.75, 0.85, 0.5].map((w, i) => (
          <div key={i} style={{ width: `${w * 100}%`, height: i === 0 ? "9%" : "6%", borderRadius: 999, background: rgba(look.palette.fg, i === 0 ? 0.5 : 0.18) }} />
        ))}
      </div>
    )}
    {/* Glass reflection: a static sheen plus a highlight that sweeps across once. */}
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 38%)" }} />
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.22) 48%, transparent 60%)", transform: `translateX(${(glare * 2.4 - 1.2) * 100}%)` }} />
  </div>
);

const Laptop: React.FC<{ width: number; src?: string; look: Look; glare: number }> = ({ width: w, src, look, glare }) => {
  const bezel = w * 0.024;
  const screenH = w * 0.625;
  return (
    <div style={{ width: w * 1.16, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: w + bezel * 2, height: screenH + bezel * 2.4, background: "#14161c", borderRadius: `${w * 0.035}px ${w * 0.035}px ${w * 0.008}px ${w * 0.008}px`, border: "1.5px solid rgba(255,255,255,0.16)", boxSizing: "border-box" }}>
        <div style={{ position: "absolute", left: "50%", top: bezel * 0.4, width: bezel * 0.32, height: bezel * 0.32, marginLeft: -bezel * 0.16, borderRadius: "50%", background: "#2b2f38" }} />
        <div style={{ position: "absolute", left: bezel - 1.5, top: bezel * 1.2 - 1.5, width: w, height: screenH, borderRadius: w * 0.006, overflow: "hidden" }}>
          <ScreenContent src={src} look={look} glare={glare} />
        </div>
      </div>
      <div style={{ position: "relative", width: "100%", height: w * 0.034, background: "linear-gradient(180deg, #e4e6eb 0%, #b8bcc6 55%, #8d929d 100%)", borderRadius: `${w * 0.004}px ${w * 0.004}px ${w * 0.03}px ${w * 0.03}px` }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: w * 0.16, height: w * 0.012, marginLeft: -w * 0.08, background: "#9da2ad", borderRadius: `0 0 ${w * 0.012}px ${w * 0.012}px` }} />
      </div>
    </div>
  );
};

const Phone: React.FC<{ height: number; src?: string; look: Look; glare: number }> = ({ height: h, src, look, glare }) => {
  const w = h / 2.05;
  const bezel = w * 0.04;
  return (
    <div style={{ position: "relative", width: w, height: h, background: "#14161c", borderRadius: w * 0.17, border: "2px solid rgba(255,255,255,0.2)", boxSizing: "border-box", boxShadow: "inset 0 0 0 3px #2a2d35" }}>
      <div style={{ position: "absolute", left: bezel, top: bezel, right: bezel, bottom: bezel, borderRadius: w * 0.135, overflow: "hidden" }}>
        <ScreenContent src={src} look={look} glare={glare} />
      </div>
      <div style={{ position: "absolute", left: "50%", top: bezel + w * 0.035, width: w * 0.3, height: w * 0.085, marginLeft: -w * 0.15, borderRadius: w, background: "#050608" }} />
    </div>
  );
};

const Screenshot: React.FC<LayoutProps> = ({ scene, plan, look, frames, startFrame, geo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, square, width, height } = geo;
  const device = scene.device ?? (portrait ? "phone" : "laptop");
  const stacked = portrait || square;
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 90, mass: 1.1 } });
  const t = (startFrame + frame) / fps;
  const glare = interpolate(frame, [14, 50], [0, 1], clamp);
  const src = scene.image ? resolveAsset(plan, scene.image) : undefined;
  const reveal = headingRevealFrames(scene.heading, look, frames);
  const textStart = 10;

  // Slide and tilt in, then keep breathing with a slow sway.
  const sway = Math.sin(t * 0.7) * 2;
  const rotY = stacked ? (1 - enter) * 30 + sway * 0.6 : (1 - enter) * -38 + 12 + sway;
  const rotX = (1 - enter) * 14 + 4 + Math.cos(t * 0.5) * 1.2;
  const tx = stacked ? 0 : (1 - enter) * -u * 0.35;
  const ty = stacked ? (1 - enter) * u * 0.3 : 0;
  const float = Math.sin(t * 1.1) * u * 0.008;

  const laptopW = portrait ? width * 0.68 : square ? u * 0.5 : width * 0.46;
  const phoneH = portrait ? height * 0.46 : square ? u * 0.44 : u * 0.7;
  const shadowW = device === "laptop" ? laptopW * 1.1 : phoneH * 0.55;

  const deviceEl = (
    <div style={{ position: "relative", perspective: u * 2.2, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ transform: `translate(${tx}px, ${ty + float}px) rotateY(${rotY}deg) rotateX(${rotX}deg)`, transformStyle: "preserve-3d", opacity: Math.min(1, enter * 1.6) }}>
        {device === "laptop" ? <Laptop width={laptopW} src={src} look={look} glare={glare} /> : <Phone height={phoneH} src={src} look={look} glare={glare} />}
      </div>
      {/* Contact shadow: a gradient, not a blur, so it stays cheap. */}
      <div style={{ width: shadowW, height: u * 0.05, marginTop: u * 0.01, background: `radial-gradient(ellipse at center, ${look.light ? rgba(look.palette.fg, 0.22) : "rgba(0,0,0,0.55)"} 0%, rgba(0,0,0,0) 70%)`, opacity: enter }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: stacked ? "column" : "row", alignItems: "center", gap: stacked ? u * 0.05 : u * 0.1, width: stacked ? "100%" : width * 0.86 }}>
      {deviceEl}
      <div style={{ display: "flex", flexDirection: "column", gap: u * 0.03, alignItems: stacked ? "center" : "flex-start", flex: stacked ? undefined : "1 1 0", minWidth: 0 }}>
        {scene.kicker ? <Kicker look={look} text={scene.kicker} size={u * 0.03} delay={8} /> : null}
        <AnimatedHeading text={scene.heading} look={look} size={headingSize(scene.heading, u * geo.k, stacked ? 0.1 : 0.1)} delay={textStart} align={stacked ? "center" : "left"} durationInFrames={frames} />
        {scene.body ? <BodyText text={scene.body} look={look} size={u * (portrait ? 0.042 : 0.038)} delay={textStart + reveal} align={stacked ? "center" : "left"} maxWidth={u * 1.0} /> : null}
      </div>
    </div>
  );
};

const LAYOUTS: Record<CardLayout, React.FC<LayoutProps>> = {
  statement: Statement,
  bullets: Bullets,
  stat: Stat,
  quote: Quote,
  feature: Feature,
  screenshot: Screenshot,
};

// ─── titles for footage-free videos ─────────────────────────────────────────

/** Rings that ripple out from the centre: the title's accent shapes. */
const Ripples: React.FC<{ look: Look; delay?: number; size: number }> = ({ look, delay = 0, size }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {[0, 1, 2].map((i) => {
        const p = interpolate(frame - delay - i * 9, [0, 70], [0, 1], clamp);
        if (p <= 0) return null;
        return (
          <circle
            key={i}
            cx={width / 2}
            cy={height / 2}
            r={size * (0.25 + easeOutCubic(p) * 0.9)}
            fill="none"
            stroke={i === 1 ? look.style.graphics.secondary : look.palette.accent}
            strokeOpacity={(1 - p) * 0.5}
            strokeWidth={Math.max(1.5, size * 0.006)}
          />
        );
      })}
    </svg>
  );
};

/** Title lockup for motion-graphics videos: logo mark, wordmark wiping out from behind it, occasion and tagline. */
export const MotionIntro: React.FC<{ plan: EditPlan; look: Look; frames: number }> = ({ plan, look, frames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = look.unit;
  const portrait = height > width * 1.2;
  const title = look.style.headingCase === "upper" ? plan.title.toUpperCase() : plan.title;
  const stackedLockup = portrait || title.length > 16;
  const base = u * (title.length <= 10 ? 0.15 : title.length <= 18 ? 0.115 : 0.085);
  // Keep a side-by-side lockup (mark + wordmark) inside ~76% of the width.
  const titleSize = look.headingScale * (stackedLockup ? Math.min(base, (width * 0.84) / (Math.max(...title.split(/\s+/).map((w) => w.length)) * 0.6)) : Math.min(base, (width * 0.76) / (1.37 + title.length * 0.6)));
  const markSize = stackedLockup ? titleSize * 1.2 : titleSize * 1.05;
  const mark = spring({ frame: frame - 2, fps, config: { damping: 13, stiffness: 120 } });
  const wipe = easeOutCubic(interpolate(frame, [10, 34], [0, 1], clamp));
  const exit = interpolate(frame, [frames - 10, frames - 1], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <MotionField look={look} globalFrame={frame} bpm={plan.music?.bpm} />
      <Ripples look={look} delay={4} size={u} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: u * 0.05, padding: u * 0.08, transform: `scale(${1 + frame / frames * 0.04 + exit * 0.04})`, opacity: 1 - exit }}>
        <div style={{ opacity: interpolate(frame, [18, 30], [0, 1], clamp) }}>
          <Kicker look={look} text={plan.occasion} size={u * 0.03} delay={18} />
        </div>
        <div style={{ display: "flex", flexDirection: stackedLockup ? "column" : "row", alignItems: "center", gap: titleSize * 0.32 }}>
          <LogoMark look={look} title={plan.title} size={markSize} progress={mark} />
          <div style={{ clipPath: stackedLockup ? `inset(${(1 - wipe) * 100}% 0 -20% 0)` : `inset(-20% ${(1 - wipe) * 100}% -20% 0)` }}>
            <h1
              style={{
                margin: 0,
                fontFamily: look.heading,
                fontWeight: look.headingWeight,
                fontSize: titleSize,
                lineHeight: 1,
                color: look.palette.fg,
                letterSpacing: look.style.headingFont === "Inter" ? -titleSize * 0.035 : look.style.textAnimation === "fade" ? titleSize * 0.06 : 0,
                textShadow: look.style.overlay.glow ? `0 0 ${titleSize * 0.1}px ${look.palette.accent}, 0 0 ${titleSize * 0.3}px ${rgba(look.palette.accent, 0.6)}` : textShadow(look, "flat", titleSize),
                transform: stackedLockup ? `translateY(${(1 - wipe) * -titleSize * 0.4}px)` : `translateX(${(1 - wipe) * -titleSize * 0.6}px)`,
                whiteSpace: stackedLockup ? "normal" : "nowrap",
                textAlign: "center",
                textWrap: "balance",
              }}
            >
              {title}
            </h1>
          </div>
        </div>
        {plan.subtitle ? <BodyText text={plan.subtitle} look={look} size={u * (portrait ? 0.048 : 0.044)} delay={26} maxWidth={u * 1.2} opacity={0.88} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Closing card for motion-graphics videos: the line, then the brand lockup settles in beneath it. */
export const MotionOutro: React.FC<{ plan: EditPlan; look: Look; frames: number; startFrame: number }> = ({ plan, look, frames, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = look.unit;
  const portrait = height > width * 1.2;
  const lock = spring({ frame: frame - 14, fps, config: { damping: 200, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <MotionField look={look} globalFrame={startFrame + frame} bpm={plan.music?.bpm} variant={3} />
      <Ripples look={look} delay={10} size={u} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: u * 0.06, padding: u * 0.08, transform: `scale(${1 + (frame / frames) * 0.03})` }}>
        <AnimatedHeading text={plan.outro.text} look={look} size={headingSize(plan.outro.text, u, portrait ? 0.12 : 0.12)} highlight="last" durationInFrames={frames} maxWidth={portrait ? "100%" : width * 0.75} />
        <div style={{ opacity: lock, transform: `translateY(${(1 - lock) * u * 0.04}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: u * 0.025 }}>
          <BrandLockup look={look} title={plan.title} size={u * 0.05} />
          {plan.subtitle ? (
            <span style={{ fontFamily: look.body, fontSize: u * 0.032, fontWeight: look.bodyWeight, color: look.palette.fg, opacity: 0.8, textAlign: "center" }}>{plan.subtitle}</span>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
