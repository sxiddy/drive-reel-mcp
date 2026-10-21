"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Aspect = "16:9" | "9:16" | "1:1";
export type CompareVersion = { n: number; src: string; poster: string; aspect: Aspect; width: number; height: number; durationSeconds: number; createdAt: string; label?: string };
type Mode = "side" | "wipe";
type Audio = "a" | "b" | "off";

const fmt = (s: number) => {
  const t = Math.max(0, s || 0);
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
};
const RATIO: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

/**
 * Plays two versions in lockstep. The longer one is the clock; the other follows it, nudging its
 * playbackRate for small drift and jumping for large drift, and pauses while either one buffers.
 */
function useSyncedPair(a: React.RefObject<HTMLVideoElement | null>, b: React.RefObject<HTMLVideoElement | null>, deps: unknown[], layout: unknown) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const want = useRef(false);
  const waiting = useRef(new Set<HTMLVideoElement>());
  /** Position to restore when the layout swaps in fresh video elements. */
  const last = useRef(0);

  const pair = useCallback(() => {
    const x = a.current;
    const y = b.current;
    if (!x || !y) return null;
    const dx = Number.isFinite(x.duration) ? x.duration : 0;
    const dy = Number.isFinite(y.duration) ? y.duration : 0;
    return dy >= dx ? { m: y, f: x, dur: dy } : { m: x, f: y, dur: dx };
  }, [a, b]);

  const seek = useCallback(
    (t: number) => {
      for (const v of [a.current, b.current]) {
        if (!v) continue;
        const d = Number.isFinite(v.duration) ? v.duration : t;
        v.currentTime = Math.min(Math.max(0, t), Math.max(0, d - 0.01));
      }
      setTime(t);
    },
    [a, b],
  );

  const pause = useCallback(() => {
    want.current = false;
    setPlaying(false);
    const p = pair();
    a.current?.pause();
    b.current?.pause();
    if (p && p.m.currentTime < (p.f.duration || 0)) p.f.currentTime = p.m.currentTime;
  }, [a, b, pair]);

  const play = useCallback(async () => {
    const p = pair();
    if (!p) return;
    if (p.m.ended || p.m.currentTime >= p.dur - 0.05) seek(0);
    want.current = true;
    setPlaying(true);
    try {
      await Promise.all([p.m.play(), p.f.currentTime < (p.f.duration || Infinity) - 0.05 ? p.f.play() : Promise.resolve()]);
    } catch {
      want.current = false;
      setPlaying(false);
    }
  }, [pair, seek]);

  // Reset when the versions change.
  useEffect(() => {
    want.current = false;
    setPlaying(false);
    setTime(0);
    last.current = 0;
    waiting.current.clear();
    setBuffering(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Media events: duration, end, buffering.
  useEffect(() => {
    const vids = [a.current, b.current].filter(Boolean) as HTMLVideoElement[];
    // New elements (layout change) start paused at the last position.
    want.current = false;
    setPlaying(false);
    const onMeta = (e?: Event) => {
      setDuration(pair()?.dur ?? 0);
      const v = e?.target as HTMLVideoElement | undefined;
      if (v && e?.type === "loadedmetadata" && last.current > 0 && v.currentTime === 0) v.currentTime = Math.min(last.current, Math.max(0, v.duration - 0.01));
    };
    const onEnded = (e: Event) => {
      const p = pair();
      if (p && e.target === p.m) {
        want.current = false;
        setPlaying(false);
        p.f.pause();
      }
    };
    const onWaiting = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      if (!want.current) return;
      waiting.current.add(v);
      setBuffering(true);
      for (const o of vids) if (o !== v) o.pause();
    };
    const onReady = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      if (!waiting.current.delete(v) || waiting.current.size) return;
      setBuffering(false);
      if (want.current) {
        const p = pair();
        if (!p) return;
        p.m.play().catch(() => undefined);
        if (p.m.currentTime < (p.f.duration || 0)) p.f.play().catch(() => undefined);
      }
    };
    for (const v of vids) {
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("durationchange", onMeta);
      v.addEventListener("ended", onEnded);
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("canplay", onReady);
      v.addEventListener("playing", onReady);
    }
    onMeta();
    return () => {
      for (const v of vids) {
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeEventListener("durationchange", onMeta);
        v.removeEventListener("ended", onEnded);
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("canplay", onReady);
        v.removeEventListener("playing", onReady);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, layout, ...deps]);

  // The sync loop.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = pair();
      if (!p) return;
      const t = p.m.currentTime;
      setTime(t);
      last.current = t;
      if (!want.current || waiting.current.size) return;
      const fd = Number.isFinite(p.f.duration) ? p.f.duration : 0;
      if (t >= fd - 0.03) {
        if (!p.f.paused) p.f.pause();
        p.f.playbackRate = 1;
        return;
      }
      const drift = p.f.currentTime - t;
      if (Math.abs(drift) > 0.3) {
        p.f.currentTime = t;
        p.f.playbackRate = 1;
      } else if (Math.abs(drift) > 0.035) {
        p.f.playbackRate = Math.min(1.12, Math.max(0.88, 1 - drift * 1.6));
      } else if (p.f.playbackRate !== 1) {
        p.f.playbackRate = 1;
      }
      if (p.f.paused) p.f.play().catch(() => undefined);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pair]);

  return { playing, time, duration, buffering, play, pause, seek, toggle: () => (want.current ? pause() : play()) };
}

export function Compare({
  id,
  title,
  versions,
  initialA,
  initialB,
  initialMode,
}: {
  id: string;
  title: string;
  versions: CompareVersion[];
  initialA: number;
  initialB: number;
  initialMode?: Mode;
}) {
  const [an, setAn] = useState(initialA);
  const [bn, setBn] = useState(initialB);
  const A = versions.find((v) => v.n === an) ?? versions[0];
  const B = versions.find((v) => v.n === bn) ?? versions.at(-1)!;
  const [mode, setMode] = useState<Mode>(initialMode ?? (A.aspect === B.aspect ? "wipe" : "side"));
  const [audio, setAudio] = useState<Audio>("b");
  const [split, setSplit] = useState(50);
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sync = useSyncedPair(aRef, bRef, [A.src, B.src], mode);

  // Keep the URL shareable without a navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("a", String(A.n));
    url.searchParams.set("b", String(B.n));
    url.searchParams.set("mode", mode);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [A.n, B.n, mode]);

  useEffect(() => {
    if (aRef.current) aRef.current.muted = audio !== "a";
    if (bRef.current) bRef.current.muted = audio !== "b";
  }, [audio, A.src, B.src]);

  // Keyboard: space play/pause, arrows seek, [ ] move the wipe.
  const keys = useRef({ sync, mode });
  keys.current = { sync, mode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const { sync: s, mode: m } = keys.current;
      if (e.code === "Space") {
        e.preventDefault();
        s.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        s.seek(s.time + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1));
      } else if (m === "wipe" && (e.key === "[" || e.key === "]")) {
        setSplit((x) => Math.min(100, Math.max(0, x + (e.key === "[" ? -5 : 5))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dragWipe = (e: React.PointerEvent) => {
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };

  const pick = (which: "a" | "b", n: number) => {
    if (which === "a") setAn(n);
    else setBn(n);
    const other = versions.find((v) => v.n === (which === "a" ? bn : an));
    const next = versions.find((v) => v.n === n);
    if (next && other && next.aspect !== other.aspect) setMode("side");
  };

  const wipe = mode === "wipe";
  const frameRatio = RATIO[B.aspect];
  const bothPortrait = A.aspect !== "16:9" && B.aspect !== "16:9";
  const pct = sync.duration ? (sync.time / sync.duration) * 100 : 0;

  // A render helper, not a component: the <video> elements must survive re-renders.
  const pane = (v: CompareVersion, which: "a" | "b") => (
    <figure
      key={which}
      className={wipe ? "absolute inset-0 m-0" : "m-0 min-w-0"}
      style={wipe && which === "b" ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
    >
      {!wipe ? (
        <figcaption className="mb-2 flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${which === "a" ? "bg-white/10 text-white/80" : "bg-brand text-ink"}`}>{which === "a" ? "Before" : "After"}</span>
          <span className="truncate text-muted">
            v{v.n} · {v.aspect}
            {v.label ? ` · ${v.label}` : ""}
          </span>
        </figcaption>
      ) : null}
      <div
        className={wipe ? "h-full w-full" : "mx-auto overflow-hidden rounded-xl border border-line bg-black"}
        style={wipe ? undefined : { aspectRatio: String(RATIO[v.aspect]), maxHeight: "62dvh", maxWidth: `calc(62dvh * ${RATIO[v.aspect]})` }}
      >
        <video
          ref={which === "a" ? aRef : bRef}
          key={v.src}
          src={v.src}
          poster={v.poster}
          playsInline
          preload="auto"
          muted={audio !== which}
          onClick={sync.toggle}
          className="h-full w-full bg-black object-contain"
        />
      </div>
    </figure>
  );

  const select = "min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-panel px-2.5 py-2 text-sm text-white outline-none transition hover:border-white/30 focus:border-brand/70";

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/v/${id}?v=${B.n}`} className="inline-flex items-center gap-1 text-sm text-muted transition hover:text-white">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            {title}
          </Link>
          <h1 className="mt-1 display text-d2">Before / after</h1>
        </div>
        <div role="tablist" aria-label="Compare mode" className="flex rounded-lg border border-line bg-panel p-1">
          {(["side", "wipe"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${mode === m ? "bg-white/10 font-medium text-white" : "text-white/60 hover:text-white"}`}
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                {m === "side" ? (
                  <>
                    <rect x="2.5" y="6" width="8.5" height="12" rx="1.5" />
                    <rect x="13" y="6" width="8.5" height="12" rx="1.5" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M12 2.5v19" />
                  </>
                )}
              </svg>
              {m === "side" ? "Side by side" : "Wipe"}
            </button>
          ))}
        </div>
      </div>

      {/* Version pickers */}
      <div className="mt-5 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden text-xs font-medium uppercase tracking-[0.14em] text-muted sm:inline">Before</span>
          <select aria-label="Before version" className={select} value={A.n} onChange={(e) => pick("a", Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.n} value={v.n}>
                v{v.n} · {v.aspect}
                {v.label ? ` · ${v.label}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setAn(B.n);
            setBn(A.n);
          }}
          aria-label="Swap before and after"
          title="Swap"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-white/70 transition hover:border-white/40 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5" />
          </svg>
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden text-xs font-medium uppercase tracking-[0.14em] text-brand sm:inline">After</span>
          <select aria-label="After version" className={select} value={B.n} onChange={(e) => pick("b", Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.n} value={v.n}>
                v{v.n} · {v.aspect}
                {v.label ? ` · ${v.label}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Stage */}
      <div className="mt-5">
        {wipe ? (
          <div
            ref={frameRef}
            className="relative mx-auto touch-none select-none overflow-hidden rounded-xl border border-line bg-black"
            style={{ aspectRatio: String(frameRatio), width: `min(100%, calc(66dvh * ${frameRatio}))` }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragWipe(e);
            }}
            onPointerMove={(e) => e.buttons && dragWipe(e)}
          >
            {pane(A, "a")}
            {pane(B, "b")}
            <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(0,0,0,0.6)]" style={{ left: `${split}%` }}>
              <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-lg shadow-black/50">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
                </svg>
              </span>
            </div>
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold">Before · v{A.n}</span>
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-ink">After · v{B.n}</span>
            {sync.buffering ? <Buffering /> : null}
          </div>
        ) : (
          <div className={`relative grid items-start gap-4 ${bothPortrait ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2"}`}>
            {pane(A, "a")}
            {pane(B, "b")}
            {sync.buffering ? <Buffering /> : null}
          </div>
        )}
        {A.aspect !== B.aspect && wipe ? <p className="mt-2 text-center text-xs text-muted">These versions have different frame shapes; side by side shows each at its own shape.</p> : null}
      </div>

      {/* Transport */}
      <div className="sticky bottom-3 z-10 mx-auto mt-4 max-w-3xl rounded-xl border border-line bg-panel/90 p-3 shadow-xl shadow-black/40 md:static md:shadow-none">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={sync.toggle}
            aria-label={sync.playing ? "Pause both" : "Play both"}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-ink transition hover:scale-105"
          >
            {sync.playing ? (
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 size-4" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l10-6.5z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            aria-label="Seek both"
            min={0}
            max={sync.duration || 1}
            step={0.01}
            value={Math.min(sync.time, sync.duration || 1)}
            onChange={(e) => sync.seek(Number(e.target.value))}
            className="slider min-w-0 flex-1"
            style={{ ["--pct" as string]: `${pct}%` }}
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-white/80">
            {fmt(sync.time)} <span className="text-muted">/ {fmt(sync.duration)}</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Sound</span>
            <div className="flex rounded-md border border-line p-0.5">
              {(
                [
                  ["a", "Before"],
                  ["b", "After"],
                  ["off", "Off"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setAudio(k)} aria-pressed={audio === k} className={`rounded px-2 py-1 transition ${audio === k ? "bg-white/10 text-white" : "text-white/55 hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {wipe ? (
            <label className="flex min-w-[160px] flex-1 items-center gap-2 sm:max-w-xs">
              <span className="text-muted">Wipe</span>
              <input type="range" aria-label="Wipe position" min={0} max={100} step={0.5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="slider min-w-0 flex-1" style={{ ["--pct" as string]: `${split}%` }} />
            </label>
          ) : null}
          <span className="hidden text-muted lg:inline">Space play · ← → seek{wipe ? " · [ ] wipe" : ""}</span>
        </div>
      </div>
    </main>
  );
}

function Buffering() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/85">
        <svg viewBox="0 0 24 24" className="size-3.5 animate-spin" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Buffering
      </span>
    </div>
  );
}
