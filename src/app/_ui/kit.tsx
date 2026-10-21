/** Shared pieces of the It's a Wrap system: buttons, labels, timecodes, the tally dot. */

type Variant = "primary" | "secondary" | "ghost" | "tally";
type Size = "lg" | "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xs font-semibold text-[15px] whitespace-nowrap transition-colors duration-(--f2) active:translate-y-px disabled:cursor-not-allowed";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-press disabled:bg-well disabled:text-fg-3",
  secondary: "border border-edge text-fg hover:bg-well active:bg-line disabled:border-line disabled:text-fg-3",
  ghost: "text-fg-2 hover:text-fg hover:bg-well disabled:text-fg-3",
  tally: "bg-tally-fill text-on-tally hover:bg-tally-hover active:bg-tally-press",
};
const sizes: Record<Size, string> = { lg: "h-12 px-5", md: "h-10 px-4", sm: "h-8 px-3 text-[13px]" };

export const btn = (v: Variant = "primary", s: Size = "md", extra = "") => `${base} ${variants[v]} ${sizes[s]} ${extra}`;

/** Mono uppercase label: the camera-report voice. */
export function Label({ children, className = "", as: Tag = "p" }: { children: React.ReactNode; className?: string; as?: "p" | "span" | "dt" | "legend" | "h2" }) {
  return <Tag className={`font-mono text-label font-medium uppercase tracking-[.08em] ${className}`}>{children}</Tag>;
}

/** The steady REC light. Never pulses; blinks only while waiting on you. */
export function Tally({ blink = false, className = "" }: { blink?: boolean; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full bg-tally ${blink ? "blink" : ""} ${className}`} />;
}

const p2 = (n: number) => String(Math.floor(n)).padStart(2, "0");

/** `0:30` for durations; `HH:MM:SS:FF` (24 fps) for live counters. */
export function tc(sec: number, frames = false) {
  if (!frames) return `${Math.floor(sec / 60)}:${p2(Math.round(sec % 60) === 60 ? 0 : Math.round(sec % 60))}`;
  const s = Math.max(0, sec);
  return `${p2(s / 3600)}:${p2((s % 3600) / 60)}:${p2(s % 60)}:${p2((s % 1) * 24)}`;
}

export function Timecode({ s, frames = false, className = "" }: { s: number; frames?: boolean; className?: string }) {
  return <span className={`font-mono tnum ${className}`}>{tc(s, frames)}</span>;
}

/** Container with the spec's gutters. */
export const wrap = "mx-auto w-full max-w-[1360px] px-4 sm:px-6 lg:px-10 2xl:px-14";
