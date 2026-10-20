"use client";

import { useEffect, useState } from "react";
import { SHEET_GRID } from "@/shared/media";

type Size = { w: number; h: number };
const sizes = new Map<string, Size>();
const pending = new Map<string, Promise<Size>>();

/** Natural size of a contact sheet; each sheet image is loaded once and shared by every tile. */
export function useSheetSize(url: string | undefined): Size | null {
  const [size, setSize] = useState<Size | null>(() => (url ? (sizes.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) return;
    const known = sizes.get(url);
    if (known) {
      setSize(known);
      return;
    }
    let live = true;
    let p = pending.get(url);
    if (!p) {
      p = new Promise<Size>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const s = { w: img.naturalWidth, h: img.naturalHeight };
          sizes.set(url, s);
          resolve(s);
        };
        img.onerror = reject;
        img.src = url;
      });
      pending.set(url, p);
    }
    p.then((s) => live && setSize(s)).catch(() => pending.delete(url));
    return () => {
      live = false;
    };
  }, [url]);
  return size;
}

/** Index of the contact-sheet tile whose source time is closest to `t`. */
export function nearestTile(times: number[], t: number) {
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return best;
}

/**
 * CSS background that shows one tile of a 4×2 contact sheet, cropped to cover a box of the given
 * aspect ratio (width / height). Output is in percentages, so the box can be any pixel size.
 */
export function sheetTileStyle(url: string, size: Size, index: number, boxAspect: number): React.CSSProperties {
  const { cols, rows, padding } = SHEET_GRID;
  const tileW = (size.w - (cols - 1) * padding) / cols;
  const tileH = (size.h - (rows - 1) * padding) / rows;
  const col = index % cols;
  const row = Math.min(rows - 1, Math.floor(index / cols));
  // Virtual box 100 units high; scale the sheet so one tile covers it.
  const bw = boxAspect * 100;
  const bh = 100;
  const scale = Math.max(bw / tileW, bh / tileH);
  const imgW = size.w * scale;
  const imgH = size.h * scale;
  const offX = col * (tileW + padding) * scale + (tileW * scale - bw) / 2;
  const offY = row * (tileH + padding) * scale + (tileH * scale - bh) / 2;
  // background-position % = offset / (box - image).
  const px = imgW === bw ? 0 : (-offX / (bw - imgW)) * 100;
  const py = imgH === bh ? 0 : (-offY / (bh - imgH)) * 100;
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${(imgW / bw) * 100}% ${(imgH / bh) * 100}%`,
    backgroundPosition: `${px}% ${py}%`,
    backgroundRepeat: "no-repeat",
  };
}

/** One frame of a clip, taken from its contact sheet (no video decoder needed). */
export function SheetTile({ url, times, t, boxAspect, className, style }: { url: string; times: number[]; t: number; boxAspect: number; className?: string; style?: React.CSSProperties }) {
  const size = useSheetSize(url);
  return <div className={className} style={{ ...style, ...(size ? sheetTileStyle(url, size, nearestTile(times, t), boxAspect) : null) }} />;
}
