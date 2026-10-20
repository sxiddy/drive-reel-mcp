"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/shared/media";
import type { CardScene, EditPlan } from "@/shared/plan";
import { Film, Music, Pause, Play } from "./icons";
import { SheetTile } from "./SheetThumb";
import { fmtSecs } from "./ui";

export type Upload = { key: string; name: string; kind: "audio" | "image"; progress: number; error?: string };

export const ACCEPT = {
  audio: ".mp3,.wav,.m4a,.aac,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg",
  image: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
};

type Filter = "all" | "video" | "image" | "audio";

const Plus = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className={p.className} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const Swap = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className} aria-hidden>
    <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
  </svg>
);
export const UploadIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className} aria-hidden>
    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
);

/** Small "Upload song/photo" button wired to a hidden file input. */
export function UploadButton({ kind, onUpload, disabled, label }: { kind: "audio" | "image"; onUpload: (f: File) => void; disabled?: boolean; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <UploadIcon className="size-3.5" />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT[kind]}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f);
        }}
      />
    </>
  );
}

export function UploadList({ uploads }: { uploads: Upload[] }) {
  if (!uploads.length) return null;
  return (
    <ul className="space-y-1.5">
      {uploads.map((u) => (
        <li key={u.key} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-white/80">{u.name}</span>
            <span className={`shrink-0 tabular-nums ${u.error ? "text-red-300" : "text-muted"}`}>{u.error ? "Failed" : u.progress >= 1 ? "Processing…" : `${Math.round(u.progress * 100)}%`}</span>
          </div>
          {u.error ? (
            <p className="mt-1 text-[11px] text-red-300/90">{u.error}</p>
          ) : (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full bg-brand transition-[width] ${u.progress >= 1 ? "animate-pulse" : ""}`} style={{ width: `${Math.max(4, u.progress * 100)}%` }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Plays one audio item at a time for previewing songs in the bin. */
function useAudioPreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (url: string) => {
    if (playing === url) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(url);
    a.volume = 0.8;
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(url);
  };
  return { playing, toggle };
}

export function AudioList({
  items,
  assetBase,
  musicSrc,
  readOnly,
  onUse,
  showNone,
}: {
  items: MediaItem[];
  assetBase: string;
  musicSrc: string | null;
  readOnly?: boolean;
  onUse: (item: MediaItem | null) => void;
  showNone?: boolean;
}) {
  const preview = useAudioPreview();
  return (
    <ul className="space-y-1.5" role="radiogroup" aria-label="Soundtrack">
      {showNone ? (
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={musicSrc === null}
            disabled={readOnly}
            onClick={() => onUse(null)}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-xs transition disabled:cursor-not-allowed ${
              musicSrc === null ? "border-brand/70 bg-brand/10 text-white" : "border-white/10 text-white/70 hover:bg-white/[0.05]"
            }`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/[0.06] text-white/50">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="8" />
                <path d="m6.5 17.5 11-11" />
              </svg>
            </span>
            <span className="font-medium">No music</span>
          </button>
        </li>
      ) : null}
      {items.map((it) => {
        const on = it.src === musicSrc;
        const url = `${assetBase}/${it.src}`;
        return (
          <li key={it.src} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs transition ${on ? "border-brand/70 bg-brand/10" : "border-white/10 hover:bg-white/[0.04]"}`}>
            <button
              type="button"
              onClick={() => preview.toggle(url)}
              aria-label={preview.playing === url ? `Stop preview of ${it.name}` : `Preview ${it.name}`}
              className="grid size-8 shrink-0 place-items-center rounded-md bg-emerald-400/15 text-emerald-200 transition hover:bg-emerald-400/25"
            >
              {preview.playing === url ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-white/90">{it.label && !it.label.startsWith("Uploaded") ? it.label : it.name}</span>
              <span className="block truncate text-[11px] text-muted">
                {[it.label?.startsWith("Uploaded") ? "Uploaded" : it.name, it.duration ? fmtSecs(it.duration) : null, it.bpm ? `${it.bpm} BPM` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              disabled={readOnly || on}
              onClick={() => onUse(it)}
              className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold transition disabled:cursor-default ${on ? "text-brand" : "bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"}`}
            >
              {on ? "In use" : "Use"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Poster frame straight from the clip, for videos without a contact sheet. */
function VideoThumb({ item, assetBase }: { item: MediaItem; assetBase: string }) {
  const start = item.highlights?.[0] ?? (item.duration ? item.duration * 0.25 : 0);
  return <video src={`${assetBase}/${item.src}#t=${(start + 0.1).toFixed(2)}`} preload="metadata" muted playsInline className="pointer-events-none absolute inset-0 size-full object-cover" />;
}

/** Contact-sheet thumbnail; hovering scrubs through the clip, CapCut-style. */
function Scrubber({ item, assetBase }: { item: MediaItem; assetBase: string }) {
  const [t, setT] = useState<number | null>(null);
  const base = item.highlights?.[0] ?? (item.duration ? item.duration * 0.25 : 0);
  if (!(item.sheet && item.sheetTimes?.length)) return <VideoThumb item={item} assetBase={assetBase} />;
  const times = item.sheetTimes;
  return (
    <div
      className="absolute inset-0"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
        setT(times[Math.floor(f * times.length)]);
      }}
      onMouseLeave={() => setT(null)}
    >
      <SheetTile url={`${assetBase}/${item.sheet}`} times={times} t={t ?? base} boxAspect={4 / 3} className="absolute inset-0 bg-white/[0.04]" />
      {t !== null ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-brand" style={{ width: `${((times.indexOf(t) + 1) / times.length) * 100}%` }} /> : null}
    </div>
  );
}

function MediaCard({
  item,
  assetBase,
  used,
  fresh,
  canReplace,
  replaceLabel,
  readOnly,
  onAdd,
  onReplace,
}: {
  item: MediaItem;
  assetBase: string;
  used: boolean;
  fresh: boolean;
  canReplace: boolean;
  replaceLabel: string;
  readOnly?: boolean;
  onAdd: () => void;
  onReplace: () => void;
}) {
  return (
    <li className="group min-w-0">
      <div className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-white/[0.04] ring-1 transition ${fresh ? "ring-2 ring-brand" : "ring-white/10 group-hover:ring-white/30"}`}>
        {item.kind === "video" ? (
          <Scrubber item={item} assetBase={assetBase} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${assetBase}/${item.src}`} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/70 to-transparent" />
        {item.kind === "video" && item.duration ? (
          <span className="pointer-events-none absolute bottom-1 right-1.5 text-[10px] font-medium tabular-nums text-white">{fmtSecs(item.duration)}</span>
        ) : null}
        {item.kind === "image" ? <span className="pointer-events-none absolute bottom-1 right-1.5 text-[10px] font-medium text-white/80">Photo</span> : null}
        {used ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/65 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white/80">In video</span>
        ) : fresh ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-brand px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-ink">New</span>
        ) : null}
        {!readOnly ? (
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {canReplace ? (
              <button
                type="button"
                onClick={onReplace}
                title={replaceLabel}
                aria-label={`${replaceLabel} with ${item.name}`}
                className="grid size-7 place-items-center rounded-full bg-black/70 text-white shadow ring-1 ring-white/20 transition hover:bg-black/90"
              >
                <Swap className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAdd}
              title="Add to timeline"
              aria-label={`Add ${item.name} to the timeline`}
              className="grid size-7 place-items-center rounded-full bg-brand text-ink shadow transition hover:scale-105"
            >
              <Plus className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[11px] text-white/60" title={item.name}>
        {item.name}
      </p>
    </li>
  );
}

export function MediaBin({
  items,
  assetBase,
  plan,
  selectedLabel,
  readOnly,
  uploads,
  freshSrc,
  onAdd,
  onReplace,
  onUseAudio,
  onUpload,
}: {
  items: MediaItem[];
  assetBase: string;
  plan: EditPlan;
  /** e.g. "Shot 3" when a shot is selected (enables Replace). */
  selectedLabel: string | null;
  readOnly?: boolean;
  uploads: Upload[];
  freshSrc: string | null;
  onAdd: (item: MediaItem) => void;
  onReplace: (item: MediaItem) => void;
  onUseAudio: (item: MediaItem | null) => void;
  onUpload: (kind: "audio" | "image", file: File) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const used = new Set<string>();
  for (const s of plan.scenes) if (s.kind !== "card") used.add(s.src);
  const visual = items.filter((i) => (i.kind === "video" || i.kind === "image") && (filter === "all" || filter === i.kind));
  const audio = items.filter((i) => i.kind === "audio");
  const counts = { all: items.length, video: items.filter((i) => i.kind === "video").length, image: items.filter((i) => i.kind === "image").length, audio: audio.length };
  const replaceLabel = selectedLabel ? `Replace ${selectedLabel}` : "Replace";

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {(
          [
            ["all", "All"],
            ["video", "Videos"],
            ["image", "Photos"],
            ["audio", "Audio"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${filter === id ? "bg-white text-ink" : "bg-white/[0.06] text-white/70 hover:bg-white/10"}`}
          >
            {label} <span className={filter === id ? "text-ink/60" : "text-white/40"}>{counts[id]}</span>
          </button>
        ))}
      </div>

      {filter !== "audio" ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="min-w-0 text-[11px] leading-snug text-muted">
              {readOnly ? "Footage Claude analysed" : selectedLabel ? <>Add after {selectedLabel}, or swap it</> : "Add to the end of the video"}
            </p>
            <UploadButton kind="image" label="Upload photo" disabled={readOnly} onUpload={(f) => onUpload("image", f)} />
          </div>
          <UploadList uploads={uploads.filter((u) => u.kind === "image")} />
          {visual.length ? (
            <ul className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2.5">
              {visual.map((it) => (
                <MediaCard
                  key={it.src}
                  item={it}
                  assetBase={assetBase}
                  used={used.has(it.src)}
                  fresh={freshSrc === it.src}
                  canReplace={!!selectedLabel}
                  replaceLabel={replaceLabel}
                  readOnly={readOnly}
                  onAdd={() => onAdd(it)}
                  onReplace={() => onReplace(it)}
                />
              ))}
            </ul>
          ) : (
            <div className="mt-2 grid place-items-center rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-xs text-muted">
              <Film className="mb-2 size-5 opacity-60" />
              No {filter === "image" ? "photos" : filter === "video" ? "videos" : "media"} yet
            </div>
          )}
        </div>
      ) : null}

      {filter === "all" || filter === "audio" ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Music className="size-3.5" /> Music
            </p>
            <UploadButton kind="audio" label="Upload song" disabled={readOnly} onUpload={(f) => onUpload("audio", f)} />
          </div>
          <div className="space-y-2">
            <UploadList uploads={uploads.filter((u) => u.kind === "audio")} />
            {audio.length ? (
              <AudioList items={audio} assetBase={assetBase} musicSrc={plan.music?.src ?? null} readOnly={readOnly} onUse={onUseAudio} />
            ) : (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-muted">No songs yet. Upload an mp3, wav, m4a, aac or ogg.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Ready-made title cards, one per layout, shown in the Text tab. */
export const CARD_PRESETS: { label: string; hint: string; card: Omit<CardScene, "id"> }[] = [
  { label: "Statement", hint: "Big kinetic headline", card: { kind: "card", layout: "statement", heading: "New title", duration: 3 } },
  { label: "Bullet list", hint: "Points revealed on the beat", card: { kind: "card", layout: "bullets", heading: "Highlights", bullets: ["First point", "Second point", "Third point"], duration: 4 } },
  { label: "Big number", hint: "Animated counter", card: { kind: "card", layout: "stat", heading: "In numbers", stat: { value: 100, suffix: "+", label: "people joined" }, duration: 3 } },
  { label: "Quote", hint: "Pull quote with attribution", card: { kind: "card", layout: "quote", heading: "Best weekend of the year.", body: "A participant", duration: 4 } },
  { label: "Feature", hint: "Icon, headline and body", card: { kind: "card", layout: "feature", heading: "Feature name", body: "One line on why it matters.", icon: "spark", duration: 3.5 } },
];

export function TextPanel({ plan, readOnly, selectedLabel, onAdd }: { plan: EditPlan; readOnly?: boolean; selectedLabel: string | null; onAdd: (card: Omit<CardScene, "id">) => void }) {
  const { bg, fg, accent } = plan.palette;
  return (
    <div className="space-y-3 p-3">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onAdd(CARD_PRESETS[0].card)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="size-4" />
        Add text card
      </button>
      <p className="text-[11px] text-muted">{selectedLabel ? `Inserted after ${selectedLabel}.` : "Inserted at the end."} Or start from a layout:</p>
      <ul className="grid grid-cols-2 gap-2">
        {CARD_PRESETS.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => onAdd(p.card)}
              className="group block w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="relative flex aspect-video flex-col justify-center overflow-hidden rounded-lg px-2.5 ring-1 ring-white/10 transition group-hover:ring-white/40" style={{ background: bg, color: fg }}>
                <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: accent }} />
                {p.card.layout === "stat" ? (
                  <span className="text-lg font-bold leading-none" style={{ color: accent }}>
                    100+
                  </span>
                ) : p.card.layout === "bullets" ? (
                  <span className="space-y-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="size-1 rounded-full" style={{ background: accent }} />
                        <span className="h-1 rounded-full opacity-60" style={{ background: fg, width: `${60 - i * 12}%` }} />
                      </span>
                    ))}
                  </span>
                ) : p.card.layout === "quote" ? (
                  <span className="font-serif text-2xl leading-none" style={{ color: accent }}>
                    &ldquo;
                  </span>
                ) : p.card.layout === "feature" ? (
                  <span className="grid size-5 place-items-center rounded-md" style={{ background: `${accent}33`, color: accent }}>
                    ✦
                  </span>
                ) : (
                  <span className="text-sm font-bold leading-tight">Aa</span>
                )}
                <span className="mt-1 h-1 w-3/4 rounded-full opacity-50" style={{ background: fg }} />
              </span>
              <span className="mt-1 block text-[11px] font-medium text-white/80">{p.label}</span>
              <span className="block truncate text-[10px] text-muted">{p.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
