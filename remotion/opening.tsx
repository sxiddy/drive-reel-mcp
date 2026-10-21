import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset, type EditPlan } from "../shared/plan";
import type { Look } from "./components";

/** objectPosition that keeps the scene's focus point (faces) in view, else the default for its shape. */
export function framing(scene: { focus?: [number, number] }, fallback: string) {
  if (!scene.focus) return fallback;
  const [x, y] = scene.focus;
  // A little headroom: faces sit slightly above the crop's centre.
  return `${(x * 100).toFixed(1)}% ${(Math.max(0, y - 0.06) * 100).toFixed(1)}%`;
}

const letterboxOf = (look: Look, height: number) => (look.style.overlay.letterbox && look.aspect === "16:9" ? height * 0.1 : 0);

/** Small time-of-day tag at the bottom-left, e.g. "10:49 PM", slid in at the start of the shot. */
export const TimeChip: React.FC<{ text: string; look: Look; frames: number }> = ({ text, look, frames }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const u = look.unit;
  const inP = spring({ frame: frame - 2, fps, config: { damping: 18, stiffness: 170 } });
  const out = interpolate(frame, [frames - 5, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [time, ampm] = text.split(" ");
  const size = u * 0.034;
  return (
    <div
      style={{
        position: "absolute",
        left: u * 0.05,
        bottom: letterboxOf(look, height) + u * 0.05,
        transform: `translateX(${(1 - inP) * -size * 1.5}px)`,
        opacity: inP * out,
        display: "flex",
        alignItems: "baseline",
        gap: size * 0.25,
        padding: `${size * 0.2}px ${size * 0.42}px`,
        background: look.palette.accent,
        color: "#fff",
        fontFamily: look.body,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.15,
        borderRadius: size * 0.1,
        boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
      }}
    >
      <span>{time}</span>
      {ampm ? <span style={{ fontSize: size * 0.55, opacity: 0.9 }}>{ampm}</span> : null}
    </div>
  );
};

/** Event name in big spaced caps over the opening shot, with 2.39:1 bars that open once it has gone. */
export const OpeningTitle: React.FC<{ plan: EditPlan; look: Look; frames: number }> = ({ plan, look, frames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = look.unit;
  const titleIn = spring({ frame: frame - 4, fps, config: { damping: 22 } });
  const hold = Math.max(fps, Math.round(frames * 0.66));
  const titleOut = interpolate(frame, [hold, hold + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const permanent = letterboxOf(look, height);
  const bar = width > height && plan.opening?.letterbox ? Math.max(permanent, (height - width / 2.39) / 2) : 0;
  const open = interpolate(frame, [hold, Math.min(frames, hold + Math.round(fps * 0.6))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const barH = bar ? bar - (bar - permanent) * (1 - Math.pow(1 - open, 3)) : 0;
  const size = u * (plan.title.length > 16 ? 0.085 : 0.11);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: titleIn * titleOut }}>
        <div
          style={{
            fontFamily: look.heading,
            fontSize: size,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: size * (0.16 + 0.08 * (1 - titleIn)),
            textTransform: "uppercase",
            textAlign: "center",
            padding: `0 ${u * 0.06}px`,
            textShadow: "0 4px 30px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5)",
          }}
        >
          {plan.title}
        </div>
        {plan.subtitle ? (
          <div style={{ marginTop: u * 0.015, fontFamily: look.body, fontSize: u * 0.028, letterSpacing: u * 0.008, color: "#fff", opacity: 0.85, textTransform: "uppercase", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
            {plan.subtitle}
          </div>
        ) : null}
      </AbsoluteFill>
      {barH > 0.5 ? (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: barH, background: "#000" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: barH, background: "#000" }} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

/** End card over the closing group shot, blurred and darkened: title, date · place, and the music credit. */
export const BackdropOutro: React.FC<{ plan: EditPlan; look: Look; frames: number }> = ({ plan, look, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = look.unit;
  const b = plan.outro.backdrop!;
  const blurIn = interpolate(frame, [0, Math.max(1, Math.min(frames * 0.4, fps * 0.6))], [0, 1], { extrapolateRight: "clamp" });
  const t = spring({ frame: frame - 5, fps, config: { damping: 22 } });
  const line = [plan.dateLine, plan.subtitle].filter(Boolean).join("  ·  ");
  const credit = plan.music?.credit && plan.music.credit !== "Generated soundtrack" ? plan.music.credit : undefined;
  const fill = { width: "100%", height: "100%", objectFit: "cover" as const };
  const size = u * (plan.title.length > 16 ? 0.08 : 0.1);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ filter: `blur(${(blurIn * u * 0.012).toFixed(1)}px) brightness(${1 - 0.45 * blurIn}) saturate(1.1)`, transform: `scale(${1.06 + (frame / frames) * 0.04})` }}>
        {b.kind === "video" ? (
          <OffthreadVideo src={resolveAsset(plan, b.src)} trimBefore={Math.round((b.trimStart ?? 0) * fps)} muted pauseWhenBuffering style={fill} />
        ) : (
          <Img src={resolveAsset(plan, b.src)} style={fill} />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: u * 0.025, opacity: t, padding: u * 0.06 }}>
        <div
          style={{
            fontFamily: look.heading,
            fontSize: size,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: size * 0.14,
            textTransform: "uppercase",
            textAlign: "center",
            textShadow: "0 4px 30px rgba(0,0,0,0.6)",
            transform: `translateY(${(1 - t) * 20}px)`,
          }}
        >
          {plan.title}
        </div>
        <div style={{ width: u * 0.12 * t, height: Math.max(2, u * 0.004), background: look.palette.accent }} />
        {line ? (
          <div style={{ fontFamily: look.body, fontSize: u * 0.032, color: "#fff", letterSpacing: u * 0.004, opacity: 0.92, textAlign: "center", textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>{line}</div>
        ) : null}
      </AbsoluteFill>
      {credit ? (
        <div style={{ position: "absolute", left: u * 0.05, right: u * 0.05, bottom: u * 0.03, textAlign: "center", fontFamily: look.body, fontSize: u * 0.016, color: "#fff", opacity: 0.6 * t }}>
          Music: {credit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
