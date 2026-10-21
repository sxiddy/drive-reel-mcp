"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EditorVersion, RenderJobView } from "./Editor";

type Aspect = "16:9" | "9:16" | "1:1";

const FORMATS: { aspect: Aspect; name: string; use: string; w: number; h: number }[] = [
  { aspect: "16:9", name: "Landscape", use: "YouTube, TV, laptops", w: 22, h: 12.4 },
  { aspect: "9:16", name: "Vertical", use: "Reels, Shorts, TikTok", w: 9.6, h: 17 },
  { aspect: "1:1", name: "Square", use: "Feed posts", w: 14, h: 14 },
];

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const panel = "fixed inset-x-3 top-16 z-50 rounded-xl border border-white/10 bg-raised p-1.5 popover sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2";

/** The caret beside Export: queue the same edit as several frame shapes at once (one edit, every format). */
export function FormatsMenu({ current, readOnly, busy, jobs, onExport }: { current: Aspect; readOnly: boolean; busy: boolean; jobs: RenderJobView[]; onExport: (aspects: Aspect[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [picked, setPicked] = useState<Set<Aspect>>(new Set([current]));
  useEffect(() => {
    if (open) setPicked(new Set([current]));
  }, [open, current]);
  const toggle = (a: Aspect) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  const list = FORMATS.filter((f) => picked.has(f.aspect)).map((f) => f.aspect);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={readOnly}
        aria-label="Export formats"
        aria-expanded={open}
        title={readOnly ? "Open the edit link Claude gave you to export" : "Export as 16:9, 9:16 or 1:1"}
        className={`grid h-full w-8 place-items-center rounded-r-lg border-l text-sm transition ${readOnly ? "cursor-not-allowed border-white/5 bg-white/10 text-white/40" : "border-ink/20 bg-brand text-ink hover:brightness-110"}`}
      >
        <svg viewBox="0 0 24 24" className={`size-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div role="dialog" aria-label="Export formats" className={`${panel} sm:w-80`}>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Export this edit as</p>
          {FORMATS.map((f) => {
            const on = picked.has(f.aspect);
            const job = jobs.find((j) => j.kind === "version" && j.aspect === f.aspect);
            return (
              <label key={f.aspect} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition ${on ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(f.aspect)} className="size-4 accent-[var(--color-brand)]" />
                <span className="grid size-7 shrink-0 place-items-center" aria-hidden>
                  <span className={`block rounded-[3px] border-[1.5px] ${on ? "border-brand bg-brand/20" : "border-white/40"}`} style={{ width: f.w, height: f.h }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {f.aspect} <span className="font-normal text-white/60">{f.name}</span>
                  </span>
                  <span className="block truncate text-xs text-muted">{job ? (job.status === "rendering" ? `Rendering ${Math.round(job.progress * 100)}%` : "Queued") : f.use}</span>
                </span>
                {f.aspect === current ? <span className="rounded bg-white/10 px-1.5 py-px text-[10px] text-white/60">Frame</span> : null}
              </label>
            );
          })}
          <p className="px-3 pt-1 text-[11px] leading-relaxed text-muted">Each becomes its own version. Clips that don&apos;t fit the frame sit over a blurred fill; your saved edit stays {current}.</p>
          <button
            type="button"
            disabled={!list.length || busy}
            onClick={() => {
              setOpen(false);
              onExport(list);
            }}
            className="mt-2 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            {list.length > 1 ? `Export ${list.length} formats` : list.length ? `Export ${list[0]}` : "Pick a format"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Rendered versions with links to watch each and to compare any version with the one before it. */
export function VersionsMenu({ id, versions }: { id: string; versions: EditorVersion[] }) {
  const { open, setOpen, ref } = usePopover();
  const list = [...versions].reverse();
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Versions"
        title="Versions"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-white/10 ${open ? "bg-white/10 text-white" : "text-white/70"}`}
      >
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2" />
        </svg>
        <span className="hidden md:inline">Versions</span>
        <span className="hidden rounded bg-white/10 px-1 text-[11px] tabular-nums sm:inline">{versions.length}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Versions" className={`${panel} sm:w-[340px]`}>
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Versions</p>
            {versions.length > 1 ? (
              <Link href={`/v/${id}/compare?a=${list[1].n}&b=${list[0].n}`} className="text-xs font-medium text-brand hover:underline">
                Compare latest two
              </Link>
            ) : null}
          </div>
          <ul className="max-h-[50dvh] overflow-y-auto">
            {list.map((v, i) => {
              const before = list[i + 1];
              return (
                <li key={v.n} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/media/${id}/${v.poster}`} alt="" className={`h-10 shrink-0 rounded bg-black object-cover ${v.aspect === "9:16" ? "w-6" : v.aspect === "1:1" ? "w-10" : "w-[71px]"}`} loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      v{v.n}
                      {v.aspect ? <span className="rounded border border-white/15 px-1 text-[10px] font-normal text-white/70">{v.aspect}</span> : null}
                      {v.uhd ? <span className="rounded border border-brand/40 px-1 text-[10px] font-normal text-brand">4K</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {new Date(v.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {Math.round(v.durationSeconds)}s
                      {v.n === 1 ? " · Claude's cut" : v.from ? ` · from v${v.from}` : ""}
                    </p>
                  </div>
                  {before ? (
                    <Link href={`/v/${id}/compare?a=${before.n}&b=${v.n}`} title={`Compare v${before.n} → v${v.n}`} className="rounded-md px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">
                      Compare
                    </Link>
                  ) : null}
                  <Link href={`/v/${id}?v=${v.n}`} className="rounded-md px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">
                    Watch
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
