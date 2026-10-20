import React from "react";
import type { CardIcon } from "../shared/plan";

type Part = { d: string } | { circle: [number, number, number] } | { rect: [number, number, number, number, number] };

/** Clean 24×24 stroke icons. Every part is drawn in order, so they can "draw themselves" with a dash offset. */
export const ICONS: Record<CardIcon, Part[]> = {
  book: [
    { d: "M12 6.2C10.4 4.8 8.2 4 5.5 4H3v14.5h2.5c2.7 0 4.9.8 6.5 2.2" },
    { d: "M12 6.2C13.6 4.8 15.8 4 18.5 4H21v14.5h-2.5c-2.7 0-4.9.8-6.5 2.2V6.2" },
  ],
  clock: [{ circle: [12, 12, 9] }, { d: "M12 7v5.2l3.4 2" }],
  chart: [{ d: "M3.5 20.5h17" }, { d: "M7 17v-4.5" }, { d: "M12 17V9.5" }, { d: "M17 17V6" }, { d: "M5.5 9.5 10 5l3 2.5 5.5-4.5" }],
  users: [
    { circle: [9, 8, 3.6] },
    { d: "M2.5 20c0-3.7 2.9-6.3 6.5-6.3s6.5 2.6 6.5 6.3" },
    { d: "M15.5 4.6a3.6 3.6 0 0 1 0 6.9" },
    { d: "M18 14.2c2.1.8 3.5 3 3.5 5.8" },
  ],
  spark: [
    { d: "M11 3c.7 4.1 2.4 5.8 6.5 6.5-4.1.7-5.8 2.4-6.5 6.5-.7-4.1-2.4-5.8-6.5-6.5C8.6 8.8 10.3 7.1 11 3z" },
    { d: "M18.5 15c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.3 2.2-1 2.5-2.7z" },
  ],
  check: [{ circle: [12, 12, 9] }, { d: "M7.8 12.4l2.9 2.9 5.5-5.8" }],
  calendar: [
    { rect: [3, 5, 18, 16, 2.5] },
    { d: "M3 10h18" },
    { d: "M8 3v4" },
    { d: "M16 3v4" },
    { d: "M7.5 14h2.2M11 14h2.2M14.5 14h2.2M7.5 17.5h2.2M11 17.5h2.2" },
  ],
  chat: [{ d: "M20.5 11.5a8.3 8.3 0 0 1-12.3 7.3L3.5 20l1.3-4.4a8.3 8.3 0 1 1 15.7-4.1z" }, { d: "M8.3 11.5h1.2M11.4 11.5h1.2M14.5 11.5h1.2" }],
  bolt: [{ d: "M13.5 2.5 4.5 13.5H11l-1 8 9.5-11.5H13l.5-7.5z" }],
  star: [{ d: "M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6L12 17l-5.4 2.9 1.1-6-4.5-4.3 6.1-.8z" }],
  target: [{ circle: [12, 12, 9] }, { circle: [12, 12, 5.2] }, { circle: [12, 12, 1.6] }, { d: "M13.2 10.8 19.5 4.5M16.5 4.5h3v3" }],
  bulb: [{ d: "M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" }, { d: "M9.5 19h5" }, { d: "M10.5 21.5h3" }],
  search: [{ circle: [10.5, 10.5, 6.5] }, { d: "M15.3 15.3 21 21" }],
  shield: [{ d: "M12 2.8 19.5 6v5.6c0 4.6-3.2 8.3-7.5 9.6-4.3-1.3-7.5-5-7.5-9.6V6z" }, { d: "M8.6 12.1l2.4 2.4 4.4-4.7" }],
  rocket: [
    { d: "M9.5 14.5 6.2 11.2C8 6.2 11.9 3 19.5 3c0 7.6-3.2 11.5-8.2 13.3z" },
    { circle: [14.6, 8.4, 1.9] },
    { d: "M6.4 11 3.5 10.6 6.9 7.2h3.5" },
    { d: "M13 17.6l.4 2.9 3.4-3.4v-3.5" },
    { d: "M6.4 15.6c-1.6.6-2.6 2.3-2.9 4.9 2.6-.3 4.3-1.3 4.9-2.9" },
  ],
  heart: [{ d: "M12 20.3s-8.5-4.9-8.5-11a4.7 4.7 0 0 1 8.5-2.8 4.7 4.7 0 0 1 8.5 2.8c0 6.1-8.5 11-8.5 11z" }],
};

/**
 * Icon that draws itself in: each stroke animates its dash offset, one after another.
 * `progress` runs 0 → 1 over the whole drawing.
 */
export const Icon: React.FC<{ name: CardIcon; size: number; color: string; progress: number; strokeWidth?: number; fill?: string }> = ({
  name,
  size,
  color,
  progress,
  strokeWidth = 1.5,
  fill,
}) => {
  const parts = ICONS[name] ?? ICONS.spark;
  const n = parts.length;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ overflow: "visible", display: "block" }}>
      {parts.map((p, i) => {
        // Parts overlap a little so the drawing flows rather than ticking piece by piece.
        const local = Math.max(0, Math.min(1, (progress * (n + 1) - i) / 2));
        const common = {
          pathLength: 1,
          stroke: color,
          strokeWidth,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
          strokeDasharray: 1,
          strokeDashoffset: 1 - local,
          fill: fill ? fill : "none",
          fillOpacity: fill ? Math.max(0, progress * 2 - 1) * 0.18 : 0,
        };
        if ("d" in p) return <path key={i} d={p.d} {...common} />;
        if ("circle" in p) return <circle key={i} cx={p.circle[0]} cy={p.circle[1]} r={p.circle[2]} {...common} />;
        const [x, y, w, h, r] = p.rect;
        return <rect key={i} x={x} y={y} width={w} height={h} rx={r} {...common} />;
      })}
    </svg>
  );
};
