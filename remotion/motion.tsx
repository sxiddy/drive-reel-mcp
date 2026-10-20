import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mix, rgba } from "./color";
import type { Look } from "./components";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Frames per beat at the plan's tempo; ~0.5 s when there is no music. */
export const beatFrames = (fps: number, bpm?: number | null) => (bpm ? (60 / bpm) * fps : fps * 0.5);

/** 1 on each beat, decaying quickly: drives small pulses that make the graphics feel locked to the music. */
export function beatPulse(globalFrame: number, fps: number, bpm?: number | null) {
  if (!bpm) return 0;
  const b = beatFrames(fps, bpm);
  const since = ((globalFrame % b) + b) % b;
  return Math.exp(-since / (fps * 0.12));
}

/**
 * The living backdrop behind cards, titles and the outro: a slow aurora of soft gradients, the style's
 * decorative pattern and drifting particles. Driven by the timeline's global frame so it flows on
 * across scenes instead of restarting. Uses gradients only, no CSS blur, so it stays cheap in the Player.
 */
export const MotionField: React.FC<{ look: Look; globalFrame: number; bpm?: number | null; variant?: number }> = ({ look, globalFrame, bpm, variant = 0 }) => {
  const { width, height, fps } = useVideoConfig();
  const { bg, fg, accent } = look.palette;
  const g = look.style.graphics;
  const t = globalFrame / fps;
  const big = Math.max(width, height);
  const pulse = beatPulse(globalFrame, fps, bpm);
  const strength = look.light ? 0.2 : 0.3;

  const blobs = [
    { c: accent, x: 0.18 + 0.1 * Math.sin(t * 0.21 + variant), y: 0.22 + 0.08 * Math.cos(t * 0.17), r: 0.62, a: strength * (1 + pulse * 0.25) },
    { c: g.secondary, x: 0.84 + 0.08 * Math.cos(t * 0.19 + variant * 0.7), y: 0.78 + 0.1 * Math.sin(t * 0.15), r: 0.66, a: strength * 0.85 },
    { c: mix(accent, g.secondary, 0.5), x: 0.62 + 0.14 * Math.sin(t * 0.11 + 2), y: 0.12 + 0.06 * Math.sin(t * 0.23), r: 0.42, a: strength * 0.55 },
  ];

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x * width - b.r * big,
            top: b.y * height - b.r * big,
            width: b.r * big * 2,
            height: b.r * big * 2,
            background: `radial-gradient(circle at center, ${rgba(b.c, b.a)} 0%, ${rgba(b.c, b.a * 0.45)} 28%, ${rgba(b.c, 0)} 62%)`,
          }}
        />
      ))}
      <Pattern look={look} t={t} pulse={pulse} />
      {g.particles ? <Particles look={look} t={t} count={g.particles} /> : null}
      {/* Gentle edge falloff for depth. */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, ${rgba(bg, 0)} 45%, ${rgba(bg, look.light ? 0.35 : 0.6)} 100%)` }} />
      {/* Hairline highlight that sweeps slowly, like light catching glass. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(115deg, ${rgba(fg, 0)} 40%, ${rgba(fg, look.light ? 0.05 : 0.035)} 50%, ${rgba(fg, 0)} 60%)`,
          transform: `translateX(${((t * 0.06) % 1.6 - 0.8) * width}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Pattern: React.FC<{ look: Look; t: number; pulse: number }> = ({ look, t, pulse }) => {
  const { width, height } = useVideoConfig();
  const { fg, accent } = look.palette;
  const g = look.style.graphics;
  const u = look.unit;
  const mask = "radial-gradient(ellipse at 50% 50%, #000 20%, transparent 75%)";

  if (g.pattern === "grid") {
    const cell = u / 11;
    return (
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${rgba(fg, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(fg, 0.07)} 1px, transparent 1px)`,
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${(t * 6) % cell}px ${(t * 10) % cell}px`,
          WebkitMaskImage: mask,
          maskImage: mask,
        }}
      />
    );
  }

  if (g.pattern === "perspective") {
    const cell = u / 9;
    return (
      <AbsoluteFill style={{ perspective: u * 0.9, perspectiveOrigin: "50% 40%" }}>
        <div
          style={{
            position: "absolute",
            left: -width * 0.5,
            right: -width * 0.5,
            top: height * 0.58,
            height: height * 1.2,
            transform: "rotateX(72deg)",
            transformOrigin: "50% 0%",
            backgroundImage: `linear-gradient(${rgba(accent, 0.55)} 2px, transparent 2px), linear-gradient(90deg, ${rgba(g.secondary, 0.45)} 2px, transparent 2px)`,
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: `0 ${(t * cell * 0.9) % cell}px`,
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 35%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, #000 35%)",
            opacity: 0.55 + pulse * 0.25,
          }}
        />
        <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.58 - 1, height: 2, background: `linear-gradient(90deg, transparent, ${accent}, ${g.secondary}, transparent)`, opacity: 0.8 }} />
        {/* Scanlines */}
        <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, ${rgba("#000000", 0.18)} 0 2px, transparent 2px 5px)`, opacity: 0.5 }} />
      </AbsoluteFill>
    );
  }

  if (g.pattern === "stripes") {
    const w = u * 0.09;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(115deg, ${rgba(fg, 0.045)} 0 ${w}px, transparent ${w}px ${w * 3}px)`,
            backgroundPosition: `${(t * u * 0.12) % (w * 3 * 2)}px 0`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -width * 0.2,
            top: height * 0.82,
            width: width * 1.4,
            height: u * 0.05,
            background: accent,
            transform: `rotate(-6deg) translateX(${Math.sin(t * 0.5) * u * 0.04}px)`,
            opacity: 0.85,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -width * 0.2,
            top: height * 0.82 + u * 0.065,
            width: width * 1.4,
            height: u * 0.012,
            background: g.secondary,
            transform: `rotate(-6deg) translateX(${Math.cos(t * 0.5) * u * 0.05}px)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (g.pattern === "lines") {
    // Fine concentric arcs, slowly turning: quiet and editorial.
    const cx = width * 0.86;
    const cy = height * 0.18;
    return (
      <AbsoluteFill>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <g transform={`rotate(${t * 2.5} ${cx} ${cy})`}>
            {[0.22, 0.34, 0.46, 0.58, 0.7].map((r, i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={u * r}
                fill="none"
                stroke={accent}
                strokeOpacity={0.32 - i * 0.04}
                strokeWidth={1.4}
                strokeDasharray={i % 2 ? `${u * 0.004} ${u * 0.012}` : `${u * 0.5} ${u * 0.08}`}
              />
            ))}
          </g>
          <line x1={width * 0.06} y1={height * 0.9} x2={width * 0.06 + u * 0.22 * (0.6 + 0.4 * Math.sin(t * 0.4))} y2={height * 0.9} stroke={accent} strokeOpacity={0.5} strokeWidth={1.4} />
        </svg>
      </AbsoluteFill>
    );
  }

  if (g.pattern === "shapes") {
    const shapes = [0, 1, 2, 3, 4, 5, 6, 7];
    const colors = [accent, g.secondary, "#ffc93c", "#2ec4b6"];
    return (
      <AbsoluteFill>
        {shapes.map((i) => {
          // Keep shapes near the edges so they never sit under the copy.
          // Keep shapes clear of the copy: in the side margins for landscape, in the top and bottom bands for portrait.
          const side = i % 2 === 0;
          const portrait = height > width * 1.2;
          const x = portrait ? 0.08 + ((i * 0.29 + random(`sx${i}`) * 0.15) % 0.84) : side ? 0.03 + random(`sx${i}`) * 0.13 : 0.84 + random(`sx${i}`) * 0.13;
          const y = portrait
            ? side
              ? 0.08 + random(`sy${i}`) * 0.1
              : 0.84 + random(`sy${i}`) * 0.1
            : 0.08 + ((i * 0.23 + random(`sy${i}`) * 0.2) % 0.84);
          const s = u * (0.035 + random(`ss${i}`) * 0.04);
          const bob = Math.sin(t * (0.8 + random(`sb${i}`) * 0.6) + i) * u * 0.018;
          const rot = t * (random(`sr${i}`) > 0.5 ? 18 : -14) + i * 40;
          const c = colors[i % colors.length];
          const kind = i % 4;
          return (
            <svg
              key={i}
              width={s}
              height={s}
              viewBox="0 0 24 24"
              style={{ position: "absolute", left: x * width - s / 2, top: y * height - s / 2 + bob, transform: `rotate(${rot}deg)`, overflow: "visible" }}
            >
              {kind === 0 ? <circle cx={12} cy={12} r={10} fill={c} /> : null}
              {kind === 1 ? <circle cx={12} cy={12} r={9} fill="none" stroke={c} strokeWidth={4} /> : null}
              {kind === 2 ? <path d="M12 2.5 22 20H2z" fill={c} strokeLinejoin="round" stroke={c} strokeWidth={2} /> : null}
              {kind === 3 ? <path d="M2 14c3-6 5-6 7 0s4 6 6.5 0S20 8 22 12" fill="none" stroke={c} strokeWidth={3.5} strokeLinecap="round" /> : null}
            </svg>
          );
        })}
      </AbsoluteFill>
    );
  }

  // dust: a warm light leak drifting across.
  const lx = 0.5 + 0.35 * Math.sin(t * 0.13);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at ${lx * 100}% 0%, ${rgba(accent, 0.22)} 0%, ${rgba(accent, 0)} 55%)`,
        mixBlendMode: look.light ? "multiply" : "screen",
      }}
    />
  );
};

const Particles: React.FC<{ look: Look; t: number; count: number }> = ({ look, t, count }) => {
  const { width, height } = useVideoConfig();
  const u = look.unit;
  const color = look.style.graphics.pattern === "perspective" ? look.style.graphics.secondary : look.palette.fg;
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const speed = 0.012 + random(`pv${i}`) * 0.025;
        const y = (((random(`py${i}`) - t * speed) % 1) + 1) % 1;
        const x = random(`px${i}`) + Math.sin(t * 0.3 + i) * 0.01;
        const size = u * (0.0025 + random(`ps${i}`) * 0.0045);
        const twinkle = 0.5 + 0.5 * Math.sin(t * (1 + random(`pt${i}`) * 2) + i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x * width,
              top: y * height * 1.1 - height * 0.05,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity: (0.12 + random(`po${i}`) * 0.35) * (0.4 + 0.6 * twinkle),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Logo-like mark: a rounded tile with the title's initial, in the style's accent gradient. */
export const LogoMark: React.FC<{ look: Look; title: string; size: number; progress?: number }> = ({ look, title, size, progress = 1 }) => {
  const initial = (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase();
  const { accent } = look.palette;
  const radius = look.style.id === "playful" ? size * 0.5 : look.style.id === "hype" ? size * 0.06 : size * 0.28;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${accent} 0%, ${mix(accent, look.style.graphics.secondary, 0.75)} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: look.light ? `0 ${size * 0.08}px ${size * 0.3}px ${rgba(accent, 0.35)}` : `0 ${size * 0.06}px ${size * 0.4}px ${rgba(accent, 0.45)}`,
        transform: `scale(${progress}) rotate(${(1 - progress) * -40}deg)`,
      }}
    >
      <span style={{ fontFamily: look.heading, fontWeight: look.headingWeight, fontSize: size * 0.58, lineHeight: 1, color: look.light ? "#ffffff" : look.palette.bg, transform: `translateY(${size * 0.02}px)` }}>
        {initial}
      </span>
    </div>
  );
};

/** Small brand lockup for the corner of cards. */
export const BrandLockup: React.FC<{ look: Look; title: string; size: number }> = ({ look, title, size }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.45 }}>
    <LogoMark look={look} title={title} size={size * 1.25} />
    <span style={{ fontFamily: look.heading, fontWeight: look.headingWeight, fontSize: size, color: look.palette.fg, letterSpacing: look.style.headingFont === "Inter" ? -size * 0.02 : 0, whiteSpace: "nowrap" }}>
      {look.style.headingCase === "upper" ? title.toUpperCase() : title}
    </span>
  </div>
);

/** "02 / 07" with a bar that fills across the whole sequence of cards. */
export const ProgressBadge: React.FC<{ look: Look; index: number; total: number; progress: number; size: number }> = ({ look, index, total, progress, size }) => {
  const { fg } = look.palette;
  const fill = Math.min(1, (index + progress) / Math.max(1, total));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: size * 0.45 }}>
      <div style={{ fontFamily: look.body, fontSize: size, fontWeight: look.bodyStrongWeight, color: fg, fontVariantNumeric: "tabular-nums", letterSpacing: size * 0.08 }}>
        <span style={{ color: look.accentInk }}>{String(index + 1).padStart(2, "0")}</span>
        <span style={{ opacity: 0.72 }}> / {String(total).padStart(2, "0")}</span>
      </div>
      <div style={{ width: size * 6, height: Math.max(3, size * 0.14), borderRadius: size, background: rgba(fg, 0.18), overflow: "hidden" }}>
        <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: size, background: look.palette.accent }} />
      </div>
    </div>
  );
};

/** Section label above a heading: accent dot and tracked uppercase text in a hairline pill. */
export const Kicker: React.FC<{ look: Look; text: string; size: number; delay?: number }> = ({ look, text, size, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 160 } });
  const { accent } = look.palette;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.55,
        padding: `${size * 0.42}px ${size * 0.85}px`,
        borderRadius: look.style.id === "hype" ? 0 : size * 2,
        border: `${Math.max(1.5, size * 0.06)}px solid ${rgba(accent, 0.55)}`,
        background: rgba(accent, look.light ? 0.1 : 0.14),
        opacity: s,
        transform: `translateY(${(1 - s) * size}px)`,
      }}
    >
      <div style={{ width: size * 0.42, height: size * 0.42, borderRadius: "50%", background: accent, boxShadow: `0 0 ${size * 0.5}px ${rgba(accent, 0.8)}` }} />
      <span
        style={{
          fontFamily: look.body,
          fontSize: size,
          lineHeight: 1,
          fontWeight: look.bodyStrongWeight,
          letterSpacing: size * 0.14,
          color: look.light ? look.accentInk : look.palette.fg,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
};
