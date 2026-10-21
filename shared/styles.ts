/**
 * Visual styles. A "theme" that Claude proposes is one of these styles plus
 * a name, a pitch, a title, colours and a scene selection tuned to the footage.
 */

export const STYLE_IDS = ["cinematic", "hype", "nostalgic", "elegant", "playful", "clean", "neon"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export type FontKey =
  | "PlayfairDisplay"
  | "Anton"
  | "Caveat"
  | "CormorantGaramond"
  | "Fredoka"
  | "Inter"
  | "Orbitron"
  | "BebasNeue"
  | "SpaceGrotesk"
  | "Montserrat";

export type StyleDef = {
  id: StyleId;
  name: string;
  /** Told to Claude so it can match styles to footage and occasion. */
  bestFor: string;
  feel: string;
  headingFont: FontKey;
  bodyFont: FontKey;
  palette: { bg: string; fg: string; accent: string };
  /** CSS filter applied to footage. */
  grade: string;
  /** Optional colour wash blended over footage. */
  wash?: { color: string; blend: "soft-light" | "overlay" | "multiply" | "screen"; opacity: number };
  overlay: { letterbox?: boolean; grain?: number; vignette?: number; glow?: boolean };
  transition: { type: "fade" | "slide" | "wipe" | "clockWipe" | "iris" | "pushCut" | "flip" | "whip" | "none"; duration: number };
  /** Target seconds per shot; snapped to the music beat. */
  shotLength: number;
  textAnimation: "rise" | "slam" | "type" | "fade" | "pop" | "glitch";
  headingCase: "upper" | "title";
  music: { bpm: number; mode: "major" | "minor"; drums: "none" | "soft" | "four" | "halftime"; brightness: number };
  /** How the planner should rank shots: high energy first or calm and steady first. */
  prefer: "energy" | "calm" | "balanced";
  /** Default volume of the clips' own audio under the music. */
  clipVolume: number;
  /** Motion-graphics look for cards, titles and the outro. */
  graphics: {
    /** Second colour for gradients and decorations, next to the palette accent. */
    secondary: string;
    /** Decorative layer that drifts behind every card. */
    pattern: "grid" | "stripes" | "dust" | "lines" | "shapes" | "perspective";
    /** Drifting particles (0 = none). */
    particles: number;
    /** Corner radius of panels and device frames, as a fraction of the frame's short edge. */
    radius: number;
  };
};

export const STYLES: Record<StyleId, StyleDef> = {
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    bestFor: "weddings, aftermovies, travel, anniversaries, anything with scenic or emotional footage",
    feel: "Letterboxed, teal-and-orange grade, slow deliberate cuts, serif titles, swelling minor-key pad.",
    headingFont: "PlayfairDisplay",
    bodyFont: "Inter",
    palette: { bg: "#07090c", fg: "#f4efe6", accent: "#e0a458" },
    grade: "contrast(1.12) saturate(0.92) brightness(0.96)",
    wash: { color: "linear-gradient(135deg, rgba(0,128,128,0.35), rgba(255,140,0,0.25))", blend: "soft-light", opacity: 1 },
    overlay: { letterbox: true, vignette: 0.45, grain: 0.05 },
    transition: { type: "fade", duration: 0.5 },
    shotLength: 2.6,
    textAnimation: "rise",
    headingCase: "title",
    music: { bpm: 76, mode: "minor", drums: "halftime", brightness: 0.35 },
    prefer: "calm",
    clipVolume: 0.08,
    graphics: { secondary: "#2a9d8f", pattern: "dust", particles: 26, radius: 0.012 },
  },
  hype: {
    id: "hype",
    name: "Hype Reel",
    bestFor: "fests, sports, launches, parties, hackathons, high-energy footage with lots of motion",
    feel: "Fast cuts on the beat with motion-blur whips, bursts on the drop, huge condensed type, warm punchy contrast, 128 BPM drums.",
    headingFont: "Anton",
    bodyFont: "SpaceGrotesk",
    palette: { bg: "#0a0a0a", fg: "#ffffff", accent: "#ff3b30" },
    grade: "contrast(1.18) saturate(1.28) sepia(0.06) brightness(1.02)",
    wash: { color: "linear-gradient(160deg, rgba(255,150,60,0.22), rgba(255,60,40,0.12))", blend: "soft-light", opacity: 1 },
    overlay: { vignette: 0.3 },
    transition: { type: "whip", duration: 0.2 },
    shotLength: 0.95,
    textAnimation: "slam",
    headingCase: "upper",
    music: { bpm: 128, mode: "minor", drums: "four", brightness: 0.8 },
    prefer: "energy",
    clipVolume: 0.12,
    graphics: { secondary: "#ff8a00", pattern: "stripes", particles: 0, radius: 0.004 },
  },
  nostalgic: {
    id: "nostalgic",
    name: "Nostalgic Film",
    bestFor: "farewells, birthdays, reunions, throwbacks, family and friends footage",
    feel: "Warm faded film look with grain and soft vignette, handwritten captions, gentle major-key tune.",
    headingFont: "Caveat",
    bodyFont: "CormorantGaramond",
    palette: { bg: "#1b1410", fg: "#fbf1e1", accent: "#f2b880" },
    grade: "sepia(0.28) saturate(0.85) contrast(0.95) brightness(1.04)",
    wash: { color: "rgba(255,170,90,0.28)", blend: "soft-light", opacity: 1 },
    overlay: { grain: 0.12, vignette: 0.55 },
    transition: { type: "fade", duration: 0.5 },
    shotLength: 2.2,
    textAnimation: "type",
    headingCase: "title",
    music: { bpm: 92, mode: "major", drums: "soft", brightness: 0.45 },
    prefer: "balanced",
    clipVolume: 0.15,
    graphics: { secondary: "#d9734e", pattern: "dust", particles: 30, radius: 0.018 },
  },
  elegant: {
    id: "elegant",
    name: "Elegant Minimal",
    bestFor: "formal events, convocations, award nights, galas, tributes, corporate dinners",
    feel: "Airy, desaturated, thin serif type with wide tracking, slow cross-dissolves, sparse piano-like pad.",
    headingFont: "CormorantGaramond",
    bodyFont: "Montserrat",
    palette: { bg: "#f6f3ee", fg: "#1d1b18", accent: "#b08d57" },
    grade: "saturate(0.75) contrast(1.02) brightness(1.06)",
    overlay: { vignette: 0.15 },
    transition: { type: "fade", duration: 0.7 },
    shotLength: 2.8,
    textAnimation: "fade",
    headingCase: "upper",
    music: { bpm: 70, mode: "major", drums: "none", brightness: 0.3 },
    prefer: "calm",
    clipVolume: 0.06,
    graphics: { secondary: "#cbb68f", pattern: "lines", particles: 10, radius: 0.006 },
  },
  playful: {
    id: "playful",
    name: "Playful Pop",
    bestFor: "kids' birthdays, club socials, freshers, casual hangouts, pets, fun announcements",
    feel: "Bright pastel cards, bouncy pop-in text, slide and wipe transitions, upbeat major-key bounce.",
    headingFont: "Fredoka",
    bodyFont: "Fredoka",
    palette: { bg: "#fff6e9", fg: "#2a1e5c", accent: "#ff5e8a" },
    grade: "saturate(1.2) brightness(1.05)",
    overlay: {},
    transition: { type: "slide", duration: 0.45 },
    shotLength: 2,
    textAnimation: "pop",
    headingCase: "title",
    music: { bpm: 112, mode: "major", drums: "four", brightness: 0.7 },
    prefer: "energy",
    clipVolume: 0.15,
    graphics: { secondary: "#7c5cff", pattern: "shapes", particles: 0, radius: 0.04 },
  },
  clean: {
    id: "clean",
    name: "Clean Corporate",
    bestFor: "product demos, company updates, internships, college clubs, recaps that must look professional",
    feel: "Neutral grade, crisp sans-serif, accent bars and wipes, informative captions, steady modern beat.",
    headingFont: "Inter",
    bodyFont: "Inter",
    palette: { bg: "#0f172a", fg: "#f8fafc", accent: "#38bdf8" },
    grade: "contrast(1.05) saturate(1.02)",
    overlay: {},
    transition: { type: "wipe", duration: 0.5 },
    shotLength: 2.4,
    textAnimation: "rise",
    headingCase: "title",
    music: { bpm: 100, mode: "major", drums: "soft", brightness: 0.55 },
    prefer: "balanced",
    clipVolume: 0.1,
    graphics: { secondary: "#818cf8", pattern: "grid", particles: 18, radius: 0.022 },
  },
  neon: {
    id: "neon",
    name: "Neon Night",
    bestFor: "DJ nights, concerts, gaming events, night-time footage, tech fests",
    feel: "Dark, glowing magenta/cyan type, glitchy reveals, iris and clock wipes, driving synth arpeggios.",
    headingFont: "Orbitron",
    bodyFont: "SpaceGrotesk",
    palette: { bg: "#05010d", fg: "#f5e9ff", accent: "#ff2bd6" },
    grade: "contrast(1.18) saturate(1.35) hue-rotate(-8deg)",
    wash: { color: "linear-gradient(160deg, rgba(255,43,214,0.35), rgba(0,229,255,0.3))", blend: "overlay", opacity: 1 },
    overlay: { glow: true, vignette: 0.5 },
    transition: { type: "whip", duration: 0.22 },
    shotLength: 1.2,
    textAnimation: "glitch",
    headingCase: "upper",
    music: { bpm: 120, mode: "minor", drums: "four", brightness: 0.9 },
    prefer: "energy",
    clipVolume: 0.1,
    graphics: { secondary: "#00e5ff", pattern: "perspective", particles: 24, radius: 0.014 },
  },
};

export function getStyle(id: StyleId): StyleDef {
  return STYLES[id];
}
