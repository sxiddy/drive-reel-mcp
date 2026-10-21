"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MediaItem } from "@/shared/media";
import { timelineSegments, transitionFrames, type EditPlan, type Scene } from "@/shared/plan";
import { Film, Music, ZoomIn, ZoomOut } from "./icons";
import { SheetTile } from "./SheetThumb";

type Block = { key: string; start: number; frames: number; shown: number; transitionIn: number; scene?: Scene; index?: number };

/** Lays out intro, shots and outro on a frame timeline; neighbours overlap by their transition. */
export function layoutTimeline(plan: EditPlan): Block[] {
  const segs = timelineSegments(plan);
  const blocks: Block[] = [];
  let t = 0;
  segs.forEach((s, i) => {
    const tin = i > 0 ? transitionFrames(plan, segs[i - 1].frames, s.frames) : 0;
    t -= tin;
    const tout = i < segs.length - 1 ? transitionFrames(plan, s.frames, segs[i + 1].frames) : 0;
    const index = plan.scenes.findIndex((x) => x.id === s.key);
    blocks.push({ key: s.key, start: t, frames: s.frames, shown: s.frames - tout, transitionIn: tin, scene: index >= 0 ? plan.scenes[index] : undefined, index: index >= 0 ? index : undefined });
    t += s.frames;
  });
  return blocks;
}

const fmtRuler = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Timeline({
  plan,
  assetBase,
  frame,
  durationInFrames,
  selected,
  zoom,
  onZoom,
  onSeek,
  onSelect,
  onMove,
  playing,
  media,
  readOnly,
}: {
  plan: EditPlan;
  assetBase: string;
  frame: number;
  durationInFrames: number;
  selected: number | null;
  zoom: number;
  onZoom: (z: number) => void;
  onSeek: (frame: number) => void;
  onSelect: (index: number | null, frame: number) => void;
  onMove: (from: number, to: number) => void;
  playing: boolean;
  /** Media bin items by src, for contact-sheet thumbnails. */
  media: Map<string, MediaItem>;
  readOnly?: boolean;
}) {
  const blocks = useMemo(() => layoutTimeline(plan), [plan]);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const pps = zoom; // pixels per second
  const fps = plan.fps;
  const totalSecs = durationInFrames / fps;
  const width = Math.max(totalSecs * pps + 120, 600);
  const x = (f: number) => (f / fps) * pps;

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const px = x(frame) + 16;
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = px - el.clientWidth * 0.3;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, playing]);

  // Bring a newly selected shot (e.g. one just added from the media bin) into view.
  useEffect(() => {
    const el = scroller.current;
    const b = selected === null ? undefined : blocks.find((x) => x.index === selected);
    if (!el || !b) return;
    const left = 16 + x(b.start);
    const right = 16 + x(b.start + b.frames);
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, left - 60), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, blocks]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - 16;
    onSeek(Math.max(0, Math.min(durationInFrames - 1, Math.round((px / pps) * fps))));
  };

  const step = pps >= 90 ? 1 : pps >= 45 ? 2 : pps >= 22 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(totalSecs / step) + 1 }, (_, i) => i * step);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 text-xs text-muted">
        <span className="font-medium text-white/90">Timeline</span>
        <span className="tabular-nums">{plan.scenes.length} shots</span>
        <span className="hidden truncate lg:inline">Click to seek · click a shot to edit{readOnly ? "" : " · drag shots to reorder · Delete removes a shot"}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => onZoom(Math.max(14, zoom / 1.4))} className="rounded p-1 hover:bg-white/10 hover:text-white" aria-label="Zoom out">
            <ZoomOut className="size-4" />
          </button>
          <input type="range" min={14} max={160} value={zoom} onChange={(e) => onZoom(Number(e.target.value))} className="w-24" aria-label="Timeline zoom" />
          <button onClick={() => onZoom(Math.min(160, zoom * 1.4))} className="rounded p-1 hover:bg-white/10 hover:text-white" aria-label="Zoom in">
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scroller} className="timeline-scroll relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative h-full" style={{ width }}>
          {/* Ruler */}
          <div className="relative h-7 cursor-pointer select-none border-b border-white/[0.06]" onMouseDown={seekFromEvent}>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full" style={{ left: 16 + t * pps }}>
                <div className="h-2 w-px bg-white/25" />
                <span className="absolute left-1 top-2 text-[10px] tabular-nums text-muted">{fmtRuler(t)}</span>
              </div>
            ))}
          </div>

          {/* Video track */}
          <div className="relative mt-3 h-[72px] cursor-pointer" onMouseDown={(e) => e.target === e.currentTarget && seekFromEvent(e)}>
            <div className="pointer-events-none absolute -left-0 top-1/2 hidden -translate-y-1/2" />
            {blocks.map((b) => {
              const isScene = b.index !== undefined;
              const isSel = isScene && b.index === selected;
              const blockWidth = Math.max(10, x(b.shown - b.transitionIn / 2) - 2);
              return (
                <div
                  key={b.key}
                  draggable={isScene && !readOnly}
                  onDragStart={() => (drag.current = b.index ?? null)}
                  onDragOver={(e) => isScene && e.preventDefault()}
                  onDrop={() => {
                    if (drag.current !== null && b.index !== undefined) onMove(drag.current, b.index);
                    drag.current = null;
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect(b.index ?? null, b.start + Math.min(8, b.frames / 2))}
                  title={isScene ? `Shot ${b.index! + 1} · ${(b.frames / fps).toFixed(1)}s` : b.key}
                  className={`group absolute top-0 h-full overflow-hidden rounded-md border transition-[box-shadow,border-color] ${
                    isSel ? "z-10 border-brand shadow-[0_0_0_2px_rgba(245,196,81,0.35)]" : "border-white/10 hover:border-white/40"
                  }`}
                  style={{ left: 16 + x(b.start + b.transitionIn / 2), width: blockWidth }}
                >
                  <BlockFace block={b} plan={plan} assetBase={assetBase} width={blockWidth} media={media} />
                  {isScene ? (
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums text-white">
                      {b.index! + 1}
                      <span className="text-white/60"> · {(b.frames / fps).toFixed(1)}s</span>
                    </span>
                  ) : null}
                  {b.scene?.caption ? <span className="absolute right-1 top-1 rounded bg-brand px-1 text-[9px] font-semibold text-ink">Aa</span> : null}
                </div>
              );
            })}
            {/* Transition markers */}
            {blocks.slice(1).map((b) =>
              b.transitionIn > 0 ? (
                <div key={`t${b.key}`} className="pointer-events-none absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: 16 + x(b.start + b.transitionIn / 2) - 1 }}>
                  <div className="size-3 rotate-45 rounded-[2px] border border-white/50 bg-raised" />
                </div>
              ) : null,
            )}
          </div>

          {/* Music track */}
          <div className="relative mt-2 h-7" onMouseDown={seekFromEvent}>
            {plan.music ? (
              <div
                className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 text-[11px] text-emerald-200/90"
                style={{ left: 16, width: x(durationInFrames) }}
              >
                <Music className="size-3.5 shrink-0" />
                <span className="truncate">
                  {plan.music.credit ?? "Soundtrack"} · {plan.music.bpm} BPM · {Math.round(plan.music.volume * 100)}%
                </span>
                <Wave seed={plan.music.bpm} width={x(durationInFrames)} />
              </div>
            ) : (
              <div className="absolute inset-y-0 flex items-center rounded-md border border-dashed border-white/10 px-2 text-[11px] text-muted" style={{ left: 16, width: x(durationInFrames) }}>
                No music
              </div>
            )}
          </div>

          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: 16 + x(frame) }}>
            <div className="absolute -left-[5px] top-0 h-2.5 w-[11px] rounded-b-sm bg-brand" />
            <div className="absolute left-0 top-0 h-full w-px bg-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}

const TRACK_HEIGHT = 72;

function BlockFace({ block, plan, assetBase, width, media }: { block: Block; plan: EditPlan; assetBase: string; width: number; media: Map<string, MediaItem> }) {
  const s = block.scene;
  if (!s) {
    return (
      <div className="flex size-full items-center gap-1.5 px-2 text-[11px] font-medium" style={{ background: `linear-gradient(135deg, ${plan.palette.bg}, ${plan.palette.accent}55)`, color: plan.palette.fg }}>
        <Film className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{block.key === "intro" ? "Title" : "Outro"}</span>
      </div>
    );
  }
  if (s.kind === "card") {
    return (
      <div className="flex size-full flex-col justify-center gap-0.5 p-1.5 pb-5 text-[10px] leading-tight" style={{ background: `linear-gradient(135deg, ${plan.palette.bg}, ${plan.palette.accent}33)`, color: plan.palette.fg }}>
        {s.kicker ? <span className="truncate text-[8px] font-semibold uppercase tracking-wider opacity-60">{s.kicker}</span> : null}
        <span className="line-clamp-2 font-medium">{s.heading}</span>
      </div>
    );
  }
  const src = `${assetBase}/${s.src}`;
  if (s.kind === "image") {
    // One image, repeated along the block like a filmstrip.
    return <div className="size-full bg-repeat-x" style={{ backgroundImage: `url("${src}")`, backgroundSize: "auto 100%", backgroundPosition: "left center" }} />;
  }
  const item = media.get(s.src);
  if (item?.sheet && item.sheetTimes?.length) {
    // Filmstrip from the clip's contact sheet: one image for the whole clip instead of a decoder per tile.
    const tiles = Math.max(1, Math.round(width / 96));
    const tileW = width / tiles;
    const span = s.duration * s.speed;
    const sheet = `${assetBase}/${item.sheet}`;
    return (
      <div className="flex size-full">
        {Array.from({ length: tiles }, (_, i) => (
          <SheetTile key={i} url={sheet} times={item.sheetTimes!} t={s.trimStart + ((i + 0.5) * span) / tiles} boxAspect={tileW / TRACK_HEIGHT} className="h-full min-w-0 flex-1 bg-white/[0.04]" />
        ))}
      </div>
    );
  }
  // No contact sheet (legacy video): a single poster frame from the clip itself.
  return <video src={`${src}#t=${(s.trimStart + 0.1).toFixed(2)}`} preload="metadata" muted playsInline className="pointer-events-none size-full object-cover" />;
}

/** Decorative waveform so the music lane reads as audio at a glance. */
function Wave({ seed, width }: { seed: number; width: number }) {
  const bars = Math.max(10, Math.floor(width / 5));
  return (
    <svg className="absolute inset-0 -z-10 h-full w-full opacity-40" preserveAspectRatio="none" viewBox={`0 0 ${bars} 10`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        // Rounded so server and client markup match exactly.
        const h = Math.round((2 + Math.abs(Math.sin(i * 0.7 + seed) * Math.cos(i * 0.13)) * 7) * 100) / 100;
        return <rect key={i} x={i + 0.2} y={Math.round((5 - h / 2) * 100) / 100} width={0.6} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}
