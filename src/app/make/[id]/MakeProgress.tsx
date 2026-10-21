"use client";

import { ArrowRight, Bell, Scissors } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, ViewTransition } from "react";
import type { MakeStatus, MakeTheme } from "@/shared/make";
import { storeKey } from "@/src/lib/editKey";
import { rememberMake } from "../../history";
import { Label, Tally, btn, tc } from "../../_ui/kit";
import { Reel } from "../../_ui/Reel";

const STEPS = [
  { key: "analyzing", label: "Watching footage", tag: "Dailies" },
  { key: "themes", label: "Writing themes", tag: "Pitches" },
  { key: "choose", label: "Pick a theme", tag: "Your call" },
  { key: "rendering", label: "Making the video", tag: "In the edit" },
  { key: "done", label: "Ready", tag: "Wrap" },
] as const;

const stepIndex = (s: MakeStatus["step"]) => (s === "queued" ? 0 : s === "error" ? -1 : STEPS.findIndex((x) => x.key === s));

const fmt = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, "0")}s`);
const two = (n: number) => String(n).padStart(2, "0");
const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];

/** Rough time left from how fast progress has moved in this step so far. */
function useEta(step: string | undefined, progress: number) {
  const since = useRef<{ step?: string; t: number; p: number }>({ t: Date.now(), p: 0 });
  if (since.current.step !== step) since.current = { step, t: Date.now(), p: progress };
  const done = progress - since.current.p;
  const elapsed = (Date.now() - since.current.t) / 1000;
  if (done < 0.05 || elapsed < 8) return null;
  return ((1 - progress) * elapsed) / done;
}

function notify(title: string, body: string) {
  try {
    if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, icon: "/favicon.ico" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}

/** Sets this page's room lighting. `lights` crossfades the registered colour tokens. */
function setRoom(tone: "office" | "dark", lights: boolean) {
  const el = document.querySelector<HTMLElement>("[data-room]");
  if (!el) return;
  el.classList.toggle("lights", lights);
  el.dataset.room = tone;
}

export function MakeProgress({ id }: { id: string }) {
  const [s, setS] = useState<MakeStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [, setNow] = useState(Date.now());
  const prevStep = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    const res = await fetch(`/api/make/${id}`, { cache: "no-store" }).catch(() => null);
    if (res?.status === 404) return setMissing(true);
    if (res?.ok) setS(await res.json());
  }, [id]);

  useEffect(() => {
    setPerm("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  // Poll while something is happening; slow down once it's waiting on the visitor or finished.
  useEffect(() => {
    load();
    const waiting = s?.step === "choose" || s?.step === "done" || s?.step === "error";
    const t = setInterval(load, waiting ? 10_000 : 1500);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load, s?.step]);

  // Moments worth a notification and a tab title change.
  useEffect(() => {
    if (!s) return;
    const was = prevStep.current;
    prevStep.current = s.step;
    if (s.step === "done" && s.result) {
      if (s.result.editKey) storeKey(s.result.videoId, s.result.editKey);
      rememberMake({ id, occasion: s.input.occasion, createdAt: s.createdAt, videoId: s.result.videoId });
    }
    document.title = s.step === "done" ? "✓ Video ready · It's a Wrap" : s.step === "choose" ? "✓ Themes ready · It's a Wrap" : s.step === "error" ? "Failed · It's a Wrap" : `${Math.round(s.progress * 100)}% · ${STEPS[Math.max(0, stepIndex(s.step))].label}`;
    if (!was || was === s.step) return;
    if (s.step === "choose" && !s.auto) notify("Your themes are ready", `Pick one for “${s.input.occasion}”.`);
    if (s.step === "done") notify("Your video is ready", `“${s.input.occasion}” is ready to watch and edit.`);
    if (s.step === "error") notify("It's a Wrap hit a problem", s.error ?? "Open the tab to see what happened.");
  }, [s, id]);

  // Leaving the page puts the office lights back on.
  useEffect(() => () => setRoom("office", false), []);

  const eta = useEta(s?.step, s?.progress ?? 0);

  async function pick(themeId: string) {
    setPicking(themeId);
    setPickError(null);
    const res = await fetch(`/api/make/${id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ themeId }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) setPickError(j.error ?? "Couldn't start the video. Try again.");
    else setS(j);
    setPicking(null);
  }

  if (missing) {
    return (
      <div className="py-16 sm:py-24">
        <h1 className="display text-d1">Not in the can</h1>
        <p className="mt-4 max-w-[48ch] font-serif text-lede text-fg-2">This job doesn&rsquo;t exist, or the link is incomplete.</p>
        <Link href="/" className={btn("primary", "lg", "mt-8")}>
          Make a video
        </Link>
      </div>
    );
  }

  const step = s?.step;
  const working = step === "queued" || step === "analyzing" || step === "themes" || step === "rendering";
  const chosen = s?.themes?.find((t) => t.id === s.chosen);
  const n = s?.themes?.length ?? 0;
  const title: Record<string, [string, React.ReactNode]> = {
    queued: ["Standing by", "Waiting for a free edit bay."],
    analyzing: ["Dailies", <>Watching your footage{clipOf(s?.stage) ? `: clip ${clipOf(s?.stage)![0]} of ${clipOf(s?.stage)![1]}` : ""}. You can close this tab; we&rsquo;ll keep rolling.</>],
    themes: ["Pitches", "Claude is writing 3–4 ways to cut it, from what’s actually in the footage."],
    choose: ["Your call", `${WORDS[n] ?? n} ways to cut ${s?.input.occasion ?? "it"}. Pick one, or let Claude pick.`],
    rendering: ["In the edit", "Rendering at 1080p, every cut on the beat. A few minutes."],
    done: ["That’s a wrap.", `Your ${s?.result ? Math.round(s.result.durationSeconds) : s?.input.duration}-second film is ready. Watch it, share it, or take it into the edit bay.`],
    error: ["Cut.", "Something stopped the job. Here’s what happened."],
  };
  const [head, line] = step ? title[step] : ["—", ""];

  return (
    <MotionConfig reducedMotion="user">
      <SlateHeader s={s} id={id} />

      {step === "done" && s?.result ? (
        <Wrap id={id} s={s} chosen={chosen} line={line} picking={picking} onPick={pick} />
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5 sm:mt-14">
            <div className="min-w-0">
              <h1 className="display text-d1">{head}</h1>
              <p className="mt-3 max-w-[60ch] text-title font-medium text-fg-2">{line}</p>
            </div>
            <div className="flex items-center gap-2">
              {step === "choose" && s?.themes?.length ? (
                <button onClick={() => pick(s.themes![0].id)} disabled={picking !== null} className={btn("secondary", "lg", "hidden sm:inline-flex")}>
                  {picking === s.themes[0].id ? (
                    <>
                      <Tally /> Rolling…
                    </>
                  ) : (
                    "Just make it"
                  )}
                </button>
              ) : working && perm === "default" ? (
                <button onClick={() => Notification.requestPermission().then(setPerm)} className={btn("ghost", "md")}>
                  <Bell size={16} strokeWidth={1.5} aria-hidden /> Notify me when it&rsquo;s ready
                </button>
              ) : working && perm === "granted" ? (
                <span className="text-small text-fg-3">We&rsquo;ll notify you. Feel free to switch tabs.</span>
              ) : null}
            </div>
          </div>

          <StepRuler s={s} eta={eta} />

          {s && (step === "queued" || step === "analyzing" || step === "themes") ? <Dailies s={s} /> : null}

          {step === "themes" ? (
            <ul aria-hidden className="mt-12">
              {[0, 1, 2].map((i) => (
                <li key={i} className="grid gap-6 border-t border-line py-8 lg:grid-cols-12">
                  <div className="hatch aspect-video opacity-60 lg:col-span-7" />
                  <div className="space-y-3 lg:col-span-5">
                    <div className="h-px w-24 bg-line" />
                    <div className="h-px w-2/3 bg-line" />
                    <div className="h-px w-1/2 bg-line" />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {step === "rendering" && s ? <Rendering id={id} s={s} chosen={chosen} /> : null}

          {step === "error" && s ? (
            <section className="fade-in mt-10 max-w-3xl border-l-[3px] border-err bg-surface px-5 py-5 sm:px-6">
              <Label className="text-err">What happened</Label>
              <p className="mt-2 font-serif text-prose text-fg">{s.error ?? "The job failed."}</p>
              <Label className="mt-6 text-fg-3">What you can do</Label>
              <ul className="mt-2 list-inside list-disc space-y-1 text-small text-fg-2 marker:text-fg-3">
                <li>Check the folder is shared as &ldquo;Anyone with the link&rdquo;.</li>
                <li>Make sure it holds video clips or photos, not only sub-folders.</li>
                <li>Then start again from the call sheet.</li>
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/" className={btn("primary", "lg")}>
                  Try again
                </Link>
                <Link href="/#videos" className={btn("ghost", "lg")}>
                  Your videos
                </Link>
              </div>
            </section>
          ) : null}

          {step === "choose" && s?.themes?.length ? (
            <section className="mt-12">
              <nav aria-label="Pitches" className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-label uppercase tracking-[.08em] text-fg-3">
                {s.themes.map((t, i) => (
                  <a key={t.id} href={`#pitch-${t.id}`} className="hover:text-fg">
                    {two(i + 1)} {t.name}
                  </a>
                ))}
              </nav>
              {s.themesNote ? <p className="mt-4 text-caption text-fg-3">{s.themesNote}</p> : null}
              {s.error ? <ErrorLine>The last render failed: {s.error}</ErrorLine> : null}
              {pickError ? <ErrorLine>{pickError}</ErrorLine> : null}
              <ol className="mt-6">
                {s.themes.map((t, i) => (
                  <ThemeRow key={t.id} t={t} id={id} i={i} total={s.themes!.length} busy={picking} onPick={pick} />
                ))}
              </ol>
              <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3 sm:hidden">
                <button onClick={() => pick(s.themes![0].id)} disabled={picking !== null} className={btn("primary", "lg", "w-full")}>
                  {picking ? (
                    <>
                      <Tally /> Rolling…
                    </>
                  ) : (
                    "Just make it"
                  )}
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}
    </MotionConfig>
  );
}

const clipOf = (stage?: string) => {
  const m = stage?.match(/(\d+)\s+of\s+(\d+)/i);
  return m ? ([Number(m[1]), Number(m[2])] as const) : null;
};

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p className="fade-in mt-4 border-l-[3px] border-err bg-surface px-3 py-2.5 text-small text-fg">{children}</p>;
}

/** Live HH:MM:SS:FF from the job's start; paused while the tab is hidden. Frozen once the job stops. */
function LiveTc({ from, until }: { from?: string; until?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!from) return;
    const start = Date.parse(from);
    const paint = () => {
      const sec = ((until ? Date.parse(until) : Date.now()) - start) / 1000;
      const txt = tc(sec, true);
      if (ref.current) ref.current.textContent = reduce ? txt.slice(0, 8) : txt;
    };
    paint();
    if (until) return;
    if (reduce) {
      const t = setInterval(paint, 1000);
      return () => clearInterval(t);
    }
    let raf = 0;
    const loop = () => {
      if (document.visibilityState === "visible") paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [from, until, reduce]);
  const mins = from ? Math.floor(((until ? Date.parse(until) : Date.now()) - Date.parse(from)) / 30000) / 2 : 0;
  return (
    <>
      <span ref={ref} aria-hidden className="tnum">
        {from ? "" : "—"}
      </span>
      {from ? <span className="sr-only">{Math.floor(mins)} minutes elapsed</span> : null}
    </>
  );
}

function SlateHeader({ s, id }: { s: MakeStatus | null; id: string }) {
  const live = s && ["queued", "analyzing", "themes", "rendering"].includes(s.step);
  const cells: [string, React.ReactNode][] = [
    ["Production", s?.input.occasion ?? "—"],
    ["Runtime", s ? <span className="tnum">{tc(s.input.duration)}</span> : "—"],
    ["Roll", <span key="r" className="tnum">{id.slice(4, 10).toUpperCase()}</span>],
    ["TC", <LiveTc key="tc" from={s?.createdAt} until={s && !live && s.step !== "choose" ? s.updatedAt : undefined} />],
  ];
  return (
    <div className="mt-6 border border-line bg-surface sm:mt-10">
      <ViewTransition name="slate" share="morph">
        <div className="flex items-center justify-between bg-fg px-4 py-2.5 text-canvas sm:px-5">
          <Label>Slate</Label>
          <span className="flex items-center gap-2">
            {live ? <Tally /> : s?.step === "choose" ? <Tally blink /> : null}
            <Label className="tnum">{live || s?.step === "choose" ? "Rec" : "Sc.01 / Take 1"}</Label>
          </span>
        </div>
      </ViewTransition>
      <dl className="grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr]">
        {cells.map(([k, v], i) => (
          <div key={k} className={`min-w-0 px-4 py-4 sm:px-5 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
            <Label as="dt" className="text-fg-3">{k}</Label>
            <dd className={`mt-1.5 truncate ${k === "TC" ? "font-mono text-[2.25rem] leading-none text-fg-3 sm:text-tc-xl" : k === "Production" ? "text-title font-semibold" : "font-mono text-title"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StepRuler({ s, eta }: { s: MakeStatus | null; eta: number | null }) {
  const err = s?.step === "error";
  const idx = !s ? -1 : err ? (s.chosen ? 3 : s.themes?.length ? 2 : 0) : stepIndex(s.step);
  const p = s ? (s.step === "done" ? 1 : s.progress) : 0;
  return (
    <div className="mt-10" aria-label="Progress">
      <ol className="grid grid-cols-5">
        {STEPS.map((st, i) => {
          const state = i < idx || s?.step === "done" ? "done" : i === idx ? "now" : "todo";
          return (
            <li key={st.key} className={`relative ${state === "now" ? "" : "hidden sm:block"}`} aria-current={state === "now" ? "step" : undefined}>
              <p className={`flex items-center gap-1.5 font-mono text-label uppercase tracking-[.08em] ${state === "now" ? "text-fg" : state === "done" ? "text-fg-2" : "text-fg-3"}`}>
                {state === "done" ? <span aria-hidden className="inline-block size-1.5 bg-fg" /> : null}
                <span className="tnum">{two(i + 1)}</span> {st.tag}
                {state === "now" ? <span className="tnum text-fg-3 sm:hidden"> · {i + 1}/5</span> : null}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="relative mt-2">
        <div className="ruler" aria-hidden />
        {idx >= 0 ? (
          <span
            aria-hidden
            className={`absolute top-0 h-full w-0.5 transition-[left] duration-[1500ms] ease-linear ${err ? "bg-err" : "bg-tally"}`}
            style={{ left: `calc(${((idx + Math.min(1, p)) / 5) * 100}% - 1px)` }}
          >
            <span className={`absolute -left-[5px] -top-[1px] size-0 border-x-[6px] border-t-[6px] border-x-transparent ${err ? "border-t-err" : "border-t-tally"}`} />
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 font-mono text-tc text-fg-3">
        <span className="tnum">{s && s.step !== "done" && !err ? `${Math.round(s.progress * 100)}% of this step` : ""}</span>
        <span className="tnum">{eta && s?.step !== "done" && !err ? `about ${fmt(eta)} left in this step` : ""}</span>
      </div>
    </div>
  );
}

/** The dailies strip: one frame per clip, exposed as each one is watched. Only real counts. */
function Dailies({ s }: { s: MakeStatus }) {
  const of = clipOf(s.stage);
  const total = of?.[1] ?? s.stats?.clips ?? 8;
  const exposed = s.step === "queued" ? 0 : s.step === "themes" ? total : of ? of[0] : 0;
  const reduce = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = strip.current?.querySelector<HTMLElement>(`[data-i="${Math.max(1, exposed)}"]`);
    last?.scrollIntoView({ inline: "end", block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [exposed, reduce]);

  const facts = [
    s.stats ? `${s.stats.clips} clips, ${s.stats.photos} photos, ${s.stats.audio} ${s.stats.audio === 1 ? "song" : "songs"} found` : null,
    s.stats?.footageSeconds ? `${tc(s.stats.footageSeconds)} of footage in the folder` : null,
    s.stats?.footageSeconds ? `A ${tc(s.input.duration)} cut keeps about ${Math.max(1, Math.round((s.input.duration / s.stats.footageSeconds) * 100))}% of it` : null,
    "You can close this tab. We’ll keep rolling.",
  ].filter(Boolean) as string[];
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="mt-10" aria-label="Dailies">
      <div ref={strip} className="sprockets -mx-4 overflow-x-auto sm:mx-0" style={{ scrollbarWidth: "none" }}>
        <ol className="flex w-max gap-1.5 px-1.5">
          {Array.from({ length: total }, (_, k) => {
            const i = k + 1;
            const on = i <= exposed;
            return (
              <li key={i} data-i={i} className="relative w-36 shrink-0 sm:w-44">
                <span aria-hidden className="absolute -top-[13px] left-1 font-mono text-[10px] leading-none text-tally">
                  IAW·{String(i).padStart(4, "0")} ▸ CLIP {two(i)}
                </span>
                {on ? (
                  <motion.div
                    initial={{ x: 24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.333, ease: [0.22, 1, 0.36, 1], delay: Math.min(6, Math.max(0, i - (exposed - 6))) * 0.042 }}
                    className="develop grid aspect-video place-items-center bg-raised"
                  >
                    <span className="font-mono text-tc text-fg-2">CLIP {two(i)} ✓</span>
                  </motion.div>
                ) : (
                  <div className="hatch aspect-video" />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mt-6 grid gap-2">
        <p className="text-title font-semibold" aria-live="polite">
          {s.stage}
        </p>
        <p aria-hidden className="h-6 overflow-hidden font-serif text-prose text-fg-2">
          <span key={f} className="rise block">{facts[f % facts.length]}</span>
        </p>
        {s.stats ? (
          <p className="mt-2 font-mono text-label uppercase tracking-[.08em] text-fg-3 tnum">
            {s.stats.clips} clips · {s.stats.photos} photos · {s.stats.audio} {s.stats.audio === 1 ? "song" : "songs"}
            {s.stats.footageSeconds ? ` · ${tc(s.stats.footageSeconds)} footage` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ThemeRow({ t, id, i, total, busy, onPick }: { t: MakeTheme; id: string; i: number; total: number; busy: string | null; onPick: (id: string) => void }) {
  const delay = `calc(var(--f3) * ${Math.min(i, 6)})`;
  return (
    <li id={`pitch-${t.id}`} className={`treatment grid scroll-mt-20 gap-6 py-8 transition-opacity duration-(--f5) lg:grid-cols-12 ${busy && busy !== t.id ? "opacity-35" : ""}`}>
      <motion.div layoutId={`theme-${t.id}`} className="wipe relative aspect-video overflow-hidden bg-well lg:col-span-7" style={{ animationDelay: delay }}>
        {t.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/make/${id}/preview/${t.id}`} alt={`Preview of ${t.name}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center p-6 text-center font-serif text-d2 text-fg-2">{t.title}</div>
        )}
        <span className="absolute left-0 top-0 bg-canvas px-2 py-1 font-mono text-label uppercase tracking-[.08em]">{t.styleName}</span>
      </motion.div>
      <div className="flex flex-col lg:col-span-5">
        <p className="pitch-no font-mono text-label uppercase tracking-[.08em] text-fg-3 tnum transition-colors duration-(--f2)">
          Pitch {two(i + 1)} / {two(total)} · {t.aspect} · {t.shots} shots
        </p>
        <div className="rise" style={{ animationDelay: `calc(${delay} + var(--f2))` }}>
          <h3 className="display mt-2 text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
            {t.name}
          </h3>
          <p className="mt-3 max-w-[62ch] font-serif text-prose text-fg">{t.pitch}</p>
          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-small">
            <Label as="dt" className="pt-0.5 text-fg-3">Story</Label>
            <dd className="text-fg-2">{t.story}</dd>
            <Label as="dt" className="pt-0.5 text-fg-3">Why it fits</Label>
            <dd className="text-fg-2">{t.occasionFit}</dd>
          </dl>
        </div>
        <button onClick={() => onPick(t.id)} disabled={busy !== null} className={btn("primary", "lg", "mt-6 w-full sm:w-auto lg:mt-auto lg:self-start")}>
          {busy === t.id ? (
            <>
              <Tally /> Rolling…
            </>
          ) : (
            <>
              Cut this one <ArrowRight size={16} strokeWidth={1.5} className="arrow" aria-hidden />
            </>
          )}
        </button>
      </div>
    </li>
  );
}

function Rendering({ id, s, chosen }: { id: string; s: MakeStatus; chosen?: MakeTheme }) {
  const total = s.input.duration * 24;
  const p = `${Math.round(s.progress * 1000) / 10}%`;
  const src = chosen?.preview ? `/api/make/${id}/preview/${chosen.id}` : null;
  const others = s.footageCleared ? [] : (s.themes?.filter((t) => t.id !== s.chosen) ?? []);
  return (
    <section className="mt-10">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <motion.div layoutId={chosen ? `theme-${chosen.id}` : undefined} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="relative -mx-4 aspect-video overflow-hidden border-line bg-well sm:mx-0 sm:border lg:col-span-8" style={{ ["--p" as string]: p }}>
          {src ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="absolute inset-0 size-full object-cover [filter:grayscale(1)_brightness(.45)]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={chosen ? `Preview of ${chosen.name}` : ""} className="absolute inset-0 size-full object-cover transition-[clip-path] duration-[1500ms] ease-linear" style={{ clipPath: "inset(0 calc(100% - var(--p)) 0 0)" }} />
            </>
          ) : (
            <div className="hatch absolute inset-0" />
          )}
          <span aria-hidden className="absolute inset-y-0 w-0.5 bg-tally transition-[left] duration-[1500ms] ease-linear" style={{ left: "var(--p)" }} />
        </motion.div>
        <div className="lg:col-span-4">
          <Label className="text-fg-3">{chosen?.styleName ?? "Theme"}</Label>
          <h2 className="display mt-2 text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
            {chosen?.name ?? "Your film"}
          </h2>
          <p className="mt-4 font-mono text-tc text-fg-2 tnum">
            ≈ FRAME {String(Math.round(s.progress * total)).padStart(4, "0")} / {String(total).padStart(4, "0")}
          </p>
          <p className="mt-1 text-caption text-fg-3">Approximate, from render progress.</p>
          <p className="mt-6 text-title font-semibold" aria-live="polite">
            {s.stage}
          </p>
        </div>
      </div>
      {others.length ? (
        <details className="mt-12 border-t border-line pt-4">
          <summary className="cursor-pointer font-mono text-label uppercase tracking-[.08em] text-fg-2 hover:text-fg">Alternate pitches · {others.length}</summary>
          <ul className="mt-4">
            {others.map((t) => (
              <li key={t.id} className="border-t border-line py-3 text-small">
                <span className="font-semibold">{t.name}</span> <span className="text-fg-3">· {t.styleName}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

type VideoMeta = { title: string; versions: { file: string; poster: string; durationSeconds: number; aspect?: string }[] };

/** Done: the slate claps, the house lights go down, the film plays. Once per job. */
function Wrap({ id: makeId, s, chosen, line, picking, onPick }: { id: string; s: MakeStatus; chosen?: MakeTheme; line: React.ReactNode; picking: string | null; onPick: (id: string) => void }) {
  const videoId = s.result!.videoId;
  const reduce = useReducedMotion();
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  // phase: 0 = clap, 1 = lights down + title, 2 = player and actions
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    fetch(`/api/videos/${videoId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setMeta(j.meta));
  }, [videoId]);

  useEffect(() => {
    const key = `iaw:wrapped:${makeId}`;
    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === "1";
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: play it */
    }
    if (seen || reduce) {
      setRoom("dark", false);
      setPhase(2);
      return;
    }
    setPlay(true);
    const F = 1000 / 24;
    const t1 = setTimeout(() => {
      setRoom("dark", true);
      setPhase(1);
    }, 8 * F);
    const t2 = setTimeout(() => setPhase(2), 22 * F);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [makeId, reduce]);

  const cur = meta?.versions.at(-1);
  const others = s.themes?.filter((t) => t.id !== s.chosen) ?? [];

  return (
    <>
      <div className="relative mt-10 sm:mt-14">
        {play ? (
          <span
            aria-hidden
            className="clapstick absolute -top-7 left-0 block h-7 w-40 origin-top-left"
            style={{
              animation: "clap var(--f3) var(--ease-in) var(--f3) both",
              opacity: phase === 2 ? 0 : 1,
              transition: "opacity var(--f3) var(--ease-in)",
            }}
          />
        ) : null}
        <h1 className="display text-d1" style={play ? { animation: "jolt var(--f1) linear var(--f8) both" } : undefined}>
          <span className="gate">
            <span style={play ? { animationDelay: "calc(var(--f8) + var(--f2))" } : { animation: "none" }}>That&rsquo;s a wrap.</span>
          </span>
        </h1>
        <p className="mt-3 max-w-[60ch] text-title font-medium text-fg-2">{line}</p>
      </div>

      <section className="mt-10 grid gap-8 lg:grid-cols-12 lg:gap-6">
        <ViewTransition name="reel" share="morph">
          <div className="-mx-4 sm:mx-0 lg:col-span-8">
            {cur && phase === 2 ? (
              <Reel
                src={`/media/${videoId}/${cur.file}`}
                poster={`/media/${videoId}/${cur.poster}`}
                autoPlay
                code={`IAW·${videoId.slice(0, 6)} ▸ Take ${meta!.versions.length} · ${chosen?.aspect ?? "16:9"}`}
                aspect={(chosen?.aspect ?? "16:9").replace(":", " / ")}
              />
            ) : (
              <div className="aspect-video border border-line bg-black">
                {cur ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/media/${videoId}/${cur.poster}`} alt="" className="size-full object-contain" />
                ) : null}
              </div>
            )}
          </div>
        </ViewTransition>
        <div className="flex flex-col gap-3 lg:col-span-4">
          {chosen ? (
            <p className="font-mono text-label uppercase tracking-[.08em] text-fg-3 tnum">
              {chosen.name} · {chosen.styleName}
              {cur ? ` · ${tc(cur.durationSeconds)}` : ""}
            </p>
          ) : null}
          {phase === 2 ? (
            <>
              <Link href={`/v/${videoId}`} className={btn("primary", "lg", "rise")}>
                Watch &amp; share
              </Link>
              <Link href={`/v/${videoId}/edit`} className={btn("secondary", "lg", "rise")} style={{ animationDelay: "var(--f1)" }}>
                <Scissors size={16} strokeWidth={1.5} aria-hidden /> Open the edit bay
              </Link>
              <p className="rise text-caption text-fg-3" style={{ animationDelay: "var(--f2)" }}>
                Only this browser can edit. Anyone with the link can watch.
              </p>
            </>
          ) : null}
        </div>
      </section>

      {others.length && phase === 2 ? (
        <section className="mt-16">
          <h2 className="display text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
            Try another pitch
          </h2>
          <ul className="mt-6">
            {others.map((t) => (
              <li key={t.id} className="treatment grid grid-cols-[120px_1fr] items-center gap-4 py-4 sm:grid-cols-[160px_1fr_auto]">
                <div className="aspect-video overflow-hidden bg-well">
                  {t.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/make/${makeId}/preview/${t.id}`} alt="" className="size-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{t.name}</p>
                  <p className="truncate text-small text-fg-3">{t.styleName} · {t.aspect}</p>
                </div>
                <button onClick={() => onPick(t.id)} disabled={picking !== null} className={btn("secondary", "md", "col-span-2 sm:col-span-1")}>
                  {picking === t.id ? (
                    <>
                      <Tally /> Rolling…
                    </>
                  ) : (
                    <>
                      Cut this one <ArrowRight size={16} strokeWidth={1.5} className="arrow" aria-hidden />
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
