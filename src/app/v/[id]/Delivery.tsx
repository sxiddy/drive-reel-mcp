"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { checkEditKey, forgetKey, readStoredKey } from "@/src/lib/editKey";

type Aspect = "16:9" | "9:16" | "1:1";
export type Job = { key: string; kind: "version" | "uhd"; n: number; aspect: Aspect; scale: number; status: "queued" | "rendering"; progress: number; ahead: number };
type RenderView = { status: string; error?: string; jobs: Job[] };

// ---------------------------------------------------------------------------------------------
// Shared state: does this browser hold the edit key, and which renders are waiting.
// ---------------------------------------------------------------------------------------------

type Ctx = {
  id: string;
  access: "checking" | "edit" | "view";
  jobs: Job[];
  error: string | null;
  /** POSTs a render request with the edit key; returns an error message or null. */
  request: (body: Record<string, unknown>) => Promise<string | null>;
};
const DeliveryContext = createContext<Ctx | null>(null);
const useDelivery = () => {
  const c = useContext(DeliveryContext);
  if (!c) throw new Error("DeliveryProvider missing");
  return c;
};

export function DeliveryProvider({ id, initialJobs, children }: { id: string; initialJobs: Job[]; children: React.ReactNode }) {
  const router = useRouter();
  const [access, setAccess] = useState<Ctx["access"]>("checking");
  const [key, setKey] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const count = useRef(initialJobs.length);

  useEffect(() => {
    const k = readStoredKey(id);
    if (!k) {
      setAccess("view");
      return;
    }
    let live = true;
    checkEditKey(id, k).then((ok) => {
      if (!live) return;
      setKey(ok ? k : null);
      setAccess(ok ? "edit" : "view");
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Poll while renders are waiting; when one finishes, refresh the page so the new file shows up.
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(async () => {
      try {
        const r = (await fetch(`/api/videos/${id}/render`, { cache: "no-store" }).then((x) => x.json())) as { render: RenderView };
        const next = r.render.jobs ?? [];
        if (next.length < count.current) router.refresh();
        count.current = next.length;
        setJobs(next);
        if (r.render.error) setError(r.render.error);
      } catch {
        /* next tick */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [jobs.length, id, router]);

  const request = useCallback(
    async (body: Record<string, unknown>) => {
      if (!key) return "Open the edit link Claude gave you to make new formats.";
      try {
        const res = await fetch(`/api/videos/${id}/render`, { method: "POST", headers: { "Content-Type": "application/json", "x-edit-key": key }, body: JSON.stringify(body) });
        if (res.status === 401) {
          forgetKey(id);
          setAccess("view");
          return "This edit link is no longer valid.";
        }
        if (!res.ok) return (await res.text()) || `Request failed (${res.status})`;
        const view = (await res.json()) as RenderView;
        setError(null);
        count.current = view.jobs.length;
        setJobs(view.jobs);
        return null;
      } catch {
        return "Network error. Try again.";
      }
    },
    [id, key],
  );

  return <DeliveryContext.Provider value={{ id, access, jobs, error, request }}>{children}</DeliveryContext.Provider>;
}

// ---------------------------------------------------------------------------------------------
// Format switcher
// ---------------------------------------------------------------------------------------------

export type FormatSlot = { aspect: Aspect; n: number | null; earlierEdit?: boolean };

const FORMAT_INFO: Record<Aspect, { name: string; use: string; w: number; h: number }> = {
  "16:9": { name: "Landscape", use: "YouTube, TV", w: 22, h: 12.4 },
  "9:16": { name: "Vertical", use: "Reels, Shorts, TikTok", w: 9.6, h: 17 },
  "1:1": { name: "Square", use: "Feed posts", w: 14, h: 14 },
};

function FrameGlyph({ aspect, active }: { aspect: Aspect; active: boolean }) {
  const f = FORMAT_INFO[aspect];
  return (
    <span className="grid size-7 shrink-0 place-items-center" aria-hidden>
      <span className={`block rounded-[3px] border-[1.5px] transition ${active ? "border-brand bg-brand/20" : "border-white/45"}`} style={{ width: f.w, height: f.h }} />
    </span>
  );
}

/** Work in progress is a steady tally light, never a spinner. */
const Spinner = ({ className = "" }: { className?: string }) => <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full bg-tally ${className.replace(/size-\S+/g, "")}`} />;

/** One edit, every format: the latest render of each frame shape, and (with the edit key) "Make" for missing ones. */
export function FormatSwitcher({ slots, current, from }: { slots: FormatSlot[]; current: number; from: number | null }) {
  const { id, access, jobs, request } = useDelivery();
  const [busy, setBusy] = useState<Aspect | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const make = async (aspect: Aspect) => {
    setBusy(aspect);
    setMsg(null);
    const err = await request(from ? { aspect, from } : { aspect });
    setBusy(null);
    if (err) setMsg(err);
  };
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Formats</h2>
        <span className="text-[11px] text-muted">Same edit, every screen</span>
      </div>
      <div role="list" className="grid grid-cols-3 gap-2">
        {slots.map((s) => {
          const info = FORMAT_INFO[s.aspect];
          const job = jobs.find((j) => j.kind === "version" && j.aspect === s.aspect);
          const active = s.n === current;
          const body = (
            <>
              <FrameGlyph aspect={s.aspect} active={active} />
              <span className="mt-1.5 block text-sm font-semibold tabular-nums">{s.aspect}</span>
              <span className="block truncate text-[11px] text-muted">{info.name}</span>
            </>
          );
          const base = "group relative flex min-w-0 flex-col items-center rounded-xl border px-2 pb-2.5 pt-2 text-center transition";
          if (s.n !== null && !job) {
            return (
              <Link
                role="listitem"
                key={s.aspect}
                href={`/v/${id}?v=${s.n}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                title={`${info.name} · ${info.use}${s.earlierEdit ? " · made from an earlier edit" : ""}`}
                className={`${base} ${active ? "border-brand/70 bg-brand/[0.07] text-white" : "border-line bg-white/[0.02] text-white/80 hover:border-white/30 hover:bg-white/[0.05]"}`}
              >
                {body}
                <span className={`mt-1 rounded-full px-1.5 text-[10px] tabular-nums ${s.earlierEdit ? "bg-amber-400/10 text-amber-200/90" : "text-muted"}`}>{s.earlierEdit ? `v${s.n} · earlier edit` : `v${s.n}`}</span>
              </Link>
            );
          }
          if (job) {
            return (
              <div role="listitem" key={s.aspect} className={`${base} border-line bg-white/[0.02] text-white/80`} title={`${info.name} is ${job.status === "rendering" ? "rendering" : "queued"}`}>
                {body}
                <span className="mt-1 flex items-center gap-1 text-[10px] text-brand">
                  <Spinner className="size-3" />
                  {job.status === "rendering" ? `${Math.round(job.progress * 100)}%` : job.ahead ? `${job.ahead} ahead` : "Queued"}
                </span>
                {job.status === "rendering" ? (
                  <span className="absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full bg-brand transition-all" style={{ width: `${job.progress * 100}%` }} />
                  </span>
                ) : null}
              </div>
            );
          }
          if (access === "edit") {
            return (
              <button
                role="listitem"
                key={s.aspect}
                type="button"
                onClick={() => make(s.aspect)}
                disabled={busy !== null}
                title={`Render this edit as ${info.name} (${s.aspect}) for ${info.use}`}
                className={`${base} border-dashed border-white/15 text-white/60 hover:border-brand/60 hover:text-white disabled:cursor-wait`}
              >
                {body}
                <span className="mt-1 flex items-center gap-1 text-[10px] font-medium text-brand">{busy === s.aspect ? <Spinner className="size-3" /> : "+"} Make</span>
              </button>
            );
          }
          return (
            <div role="listitem" key={s.aspect} className={`${base} border-line/60 text-white/30`} title={`No ${info.name} version yet`}>
              {body}
              <span className="mt-1 text-[10px]">Not made</span>
            </div>
          );
        })}
      </div>
      {msg ? <p className="mt-2 text-xs text-red-300">{msg}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Render jobs (watch page)
// ---------------------------------------------------------------------------------------------

export function RenderJobs() {
  const { jobs, error } = useDelivery();
  if (!jobs.length) return error ? <p className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-100">Last render failed: {error}</p> : null;
  return (
    <ul className="space-y-2 rounded-xl border border-line bg-panel/70 p-3" aria-live="polite">
      {jobs.map((j) => (
        <li key={j.key} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-white/85">
              {j.status === "rendering" ? <Spinner className="size-3 text-brand" /> : <span className="size-1.5 rounded-full bg-white/30" />}
              {j.kind === "uhd" ? `4K of version ${j.n}` : `Version ${j.n} · ${j.aspect}`}
            </span>
            <span className="tabular-nums text-muted">{j.status === "rendering" ? `${Math.round(j.progress * 100)}%` : j.ahead ? `${j.ahead} ahead` : "Up next"}</span>
          </div>
          {j.status === "rendering" ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${Math.max(2, j.progress * 100)}%` }} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Download menu
// ---------------------------------------------------------------------------------------------

export type DownloadInfo = {
  n: number;
  aspect: Aspect;
  hd: { url: string; width: number; height: number; bytes: number | null };
  sd: { width: number; height: number; url: string | null; bytes: number | null };
  uhd: { url: string; width: number; height: number; bytes: number | null } | null;
  /** 4K can be made (the version has a plan snapshot). */
  canMakeUhd: boolean;
};

const mb = (b: number | null) => (b ? (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`) : null);

function save(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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

const DownloadIcon = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

export function DownloadMenu({ info }: { info: DownloadInfo }) {
  const { id, access, jobs, request } = useDelivery();
  const { open, setOpen, ref } = usePopover();
  const [sdState, setSdState] = useState<"idle" | "working" | "error">("idle");
  const [uhdMsg, setUhdMsg] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const uhdJob = jobs.find((j) => j.kind === "uhd" && j.n === info.n);

  const get720 = async () => {
    if (info.sd.url) return save(info.sd.url);
    setSdState("working");
    for (let tries = 0; tries < 8; tries++) {
      try {
        const res = await fetch(`/api/videos/${id}/download`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: info.n, quality: "720p" }) });
        if (res.status === 202) continue;
        if (!res.ok) break;
        const body = (await res.json()) as { url: string };
        setSdState("idle");
        save(body.url);
        return;
      } catch {
        break;
      }
    }
    setSdState("error");
  };

  const makeUhd = async () => {
    setMaking(true);
    setUhdMsg(null);
    const err = await request({ version: info.n, scale: 2 });
    setMaking(false);
    if (err) setUhdMsg(err);
  };

  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition";
  const dims = (w: number, h: number) => `${w}×${h}`;
  const Label = ({ q, tag, sub }: { q: string; tag?: string; sub: string }) => (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2 text-sm font-semibold">
        {q}
        {tag ? <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-white/70">{tag}</span> : null}
      </span>
      <span className="block truncate text-xs tabular-nums text-muted">{sub}</span>
    </span>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 transition ${open ? "border-white/40 bg-white/[0.06]" : "border-line hover:border-white/40"}`}
      >
        <DownloadIcon />
        Download
        <svg viewBox="0 0 24 24" className={`size-3.5 text-muted transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" aria-hidden />
          <div
            role="menu"
            aria-label="Download quality"
            className="fixed inset-x-3 bottom-3 z-40 rounded-xs border border-line bg-raised p-1.5 popover sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-80 lg:left-auto lg:right-0"
          >
            <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              Version {info.n} · {info.aspect}
            </p>
            <button role="menuitem" type="button" onClick={get720} disabled={sdState === "working"} className={`${row} hover:bg-white/[0.06] disabled:cursor-wait`}>
              <Label q="720p" tag="HD" sub={`${dims(info.sd.width, info.sd.height)} · ${sdState === "working" ? "preparing…" : sdState === "error" ? "couldn't prepare, try again" : (mb(info.sd.bytes) ?? "smaller file, quick to send")}`} />
              {sdState === "working" ? <Spinner className="size-4 text-brand" /> : <DownloadIcon className="size-4 text-white/60" />}
            </button>
            <a role="menuitem" href={info.hd.url} onClick={() => setOpen(false)} className={`${row} hover:bg-white/[0.06]`}>
              <Label q="1080p" tag="Full HD" sub={`${dims(info.hd.width, info.hd.height)}${mb(info.hd.bytes) ? ` · ${mb(info.hd.bytes)}` : ""} · original render`} />
              <DownloadIcon className="size-4 text-white/60" />
            </a>
            {info.uhd ? (
              <a role="menuitem" href={info.uhd.url} onClick={() => setOpen(false)} className={`${row} hover:bg-white/[0.06]`}>
                <Label q="4K" tag="Ultra HD" sub={`${dims(info.uhd.width, info.uhd.height)}${mb(info.uhd.bytes) ? ` · ${mb(info.uhd.bytes)}` : ""}`} />
                <DownloadIcon className="size-4 text-white/60" />
              </a>
            ) : uhdJob ? (
              <div className={`${row} cursor-default`}>
                <Label q="4K" tag="Ultra HD" sub={uhdJob.status === "rendering" ? `Rendering ${Math.round(uhdJob.progress * 100)}%…` : `Queued${uhdJob.ahead ? ` · ${uhdJob.ahead} ahead` : ""}`} />
                <Spinner className="size-4 text-brand" />
              </div>
            ) : access === "edit" && info.canMakeUhd ? (
              <button role="menuitem" type="button" onClick={makeUhd} disabled={making} className={`${row} hover:bg-white/[0.06] disabled:cursor-wait`}>
                <Label q="4K" tag="Ultra HD" sub={uhdMsg ?? `${dims(info.hd.width * 2, info.hd.height * 2)} · re-rendered sharp, takes a few minutes`} />
                <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-ink">{making ? <Spinner className="size-3" /> : null}Make 4K</span>
              </button>
            ) : (
              <div className={`${row} cursor-default opacity-50`} title="The owner can render a 4K copy from the edit link">
                <Label q="4K" tag="Ultra HD" sub="Not rendered for this version" />
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Share row
// ---------------------------------------------------------------------------------------------

const enc = encodeURIComponent;

export function ShareRow({ url, title, text }: { url: string; title: string; text: string }) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  const targets = [
    { name: "WhatsApp", href: `https://wa.me/?text=${enc(`${title} ${url}`)}`, bg: "#25D366", icon: <path d="M12 3.2a8.7 8.7 0 0 0-7.5 13.2L3.3 20.8l4.5-1.2A8.7 8.7 0 1 0 12 3.2Zm4.9 12.2c-.2.6-1.2 1.1-1.7 1.2-.4 0-.9.1-2.9-.7-2.4-1-4-3.5-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2 1.1 1 2.1 1.3 2.4 1.4.3.2.5.1.6 0l.9-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3Z" fill="currentColor" /> },
    { name: "X", href: `https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}`, bg: "#000", icon: <path d="M17.2 4h2.8l-6.1 7 7.2 9h-5.6l-4.4-5.7L6 20H3.2l6.5-7.5L2.8 4h5.7l4 5.2Zm-1 14.4h1.6L7.9 5.5H6.2Z" fill="currentColor" /> },
    { name: "Telegram", href: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`, bg: "#2AABEE", icon: <path d="M20.6 4.4 2.9 11.2c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.6.4.8.8.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.1c.3-1.2-.5-1.8-1.4-1.4Zm-3.3 3.3-8.2 7.4-.3 3.3-1.6-4.9 9.7-6.1c.4-.3.8 0 .4.3Z" fill="currentColor" /> },
    { name: "Email", href: `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`, bg: "#3a3f4b", icon: <path d="M4 6h16v12H4zM4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /> },
  ];
  const btn = "grid size-10 shrink-0 place-items-center rounded-xs border border-edge text-fg transition-colors hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted">Share</h2>
      <div className="flex flex-wrap items-center gap-2">
        {canShare ? (
          <button type="button" onClick={() => navigator.share({ title, text, url }).catch(() => undefined)} className={`${btn} bg-brand text-ink`} aria-label="Share…" title="Share…">
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7" />
            </svg>
          </button>
        ) : null}
        {targets.map((t) => (
          <a key={t.name} href={t.href} target={t.name === "Email" ? undefined : "_blank"} rel="noopener noreferrer" aria-label={`Share on ${t.name}`} title={t.name} className={btn}>
            <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
              {t.icon}
            </svg>
          </a>
        ))}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              window.prompt("Copy this link", url);
            }
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xs border border-edge px-4 text-sm font-semibold transition-colors hover:bg-well"
        >
          {copied ? (
            <svg viewBox="0 0 24 24" className="size-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4L11.5 6M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" />
            </svg>
          )}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
