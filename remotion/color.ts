/** Small colour helpers for palettes given as hex strings ("#rgb" or "#rrggbb"). */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0");

export function rgba(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** Linear mix of two colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${ca.map((c, i) => toHex(c + (cb[i] - c) * t)).join("")}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isLight = (hex: string) => luminance(hex) > 0.5;

/**
 * The accent colour, nudged towards the foreground until it reads as text on the background
 * (light palettes such as gold-on-cream otherwise fall well below 3:1).
 */
export function readableOn(color: string, bg: string, toward: string, min = 3.6) {
  let c = color;
  for (let t = 0.12; contrast(c, bg) < min && t <= 0.84; t += 0.12) c = mix(color, toward, t);
  return c;
}
