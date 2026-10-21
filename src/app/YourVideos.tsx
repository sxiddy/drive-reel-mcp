"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { forgetMake, readMakes } from "./history";
import { Label, Tally, tc } from "./_ui/kit";

type Card = {
  key: string;
  href: string;
  title: string;
  sub: string;
  poster?: string;
  badge?: { text: string; tone: "live" | "ready" | "wait" | "bad" };
  durationSeconds?: number;
  at: string;
};

type VideoMeta = { title: string; themeName: string; occasion: string; updatedAt: string; versions: { poster: string; durationSeconds: number }[] };

async function videoCard(videoId: string): Promise<Card | null> {
  const res = await fetch(`/api/videos/${videoId}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const { meta } = (await res.json()) as { meta: VideoMeta };
  const cur = meta.versions.at(-1);
  return {
    key: videoId,
    href: `/v/${videoId}`,
    title: meta.title,
    sub: `${meta.themeName} · ${meta.occasion}`,
    poster: cur ? `/media/${videoId}/${cur.poster}` : undefined,
    durationSeconds: cur?.durationSeconds,
    badge: { text: "Ready", tone: "ready" },
    at: meta.updatedAt,
  };
}

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * Videos made in this browser: jobs started here, plus any video whose edit link was opened here.
 * Nothing is listed publicly; other people's videos never show up.
 */
export function YourVideos() {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const out: Card[] = [];
      const seen = new Set<string>();
      for (const m of readMakes()) {
        const res = await fetch(`/api/make/${m.id}`, { cache: "no-store" }).catch(() => null);
        if (res?.status === 404) {
          forgetMake(m.id);
          continue;
        }
        const s = res?.ok ? await res.json() : null;
        if (s?.step === "done" && s.result?.videoId) {
          const c = await videoCard(s.result.videoId);
          if (c) {
            seen.add(c.key);
            out.push(c);
            continue;
          }
        }
        const badge: Card["badge"] =
          !s || s.step === "error"
            ? { text: "Cut", tone: "bad" }
            : s.step === "choose"
              ? { text: "Your call", tone: "wait" }
              : { text: `${s.step === "rendering" ? "In the edit" : s.step === "queued" ? "Standing by" : s.step === "themes" ? "Pitches" : "Dailies"} ${Math.round((s.progress ?? 0) * 100)}%`, tone: "live" };
        out.push({ key: m.id, href: `/make/${m.id}`, title: m.occasion, sub: s?.stage ?? "", badge, at: m.createdAt, poster: s?.themes?.[0]?.preview ? `/api/make/${m.id}/preview/${s.themes[0].id}` : undefined });
      }
      // Videos from Claude chat whose edit link was opened in this browser.
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? "";
          const id = k.startsWith("drive-reel:key:") ? k.slice("drive-reel:key:".length) : "";
          if (!id || seen.has(id)) continue;
          const c = await videoCard(id);
          if (c) out.push(c);
        }
      } catch {
        /* storage blocked */
      }
      out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (live) setCards(out);
    })();
    return () => {
      live = false;
    };
  }, []);

  const count = cards ? String(cards.length).padStart(2, "0") : "—";
  return (
    <>
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-6">
        <h2 className="display text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
          In the can
        </h2>
        <Label className="tnum text-fg-3">{count}</Label>
      </div>
      {cards === null ? null : !cards.length ? (
        <div className="mt-8">
          <div className="sprockets overflow-hidden" aria-hidden>
            <div className="grid grid-cols-4 gap-1.5 px-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="hatch aspect-video" />
              ))}
            </div>
          </div>
          <p className="mt-5 max-w-[52ch] font-serif text-prose text-fg-2">Nothing here yet. Paste a folder above and your first film lands here.</p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <li key={c.key} className="rise" style={{ animationDelay: `calc(var(--f1) * ${Math.min(i, 6)})` }}>
              <Link href={c.href} className="group grid grid-cols-[112px_1fr] gap-4 sm:block">
                <div className="relative aspect-video overflow-hidden border border-line bg-well">
                  {c.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.poster} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="hatch size-full" />
                  )}
                </div>
                <div className="min-w-0 sm:mt-3">
                  <p className="font-mono text-label uppercase tracking-[.08em] text-fg-3">
                    <span className="tnum">#{String(cards.length - i).padStart(2, "0")}</span>
                    {c.durationSeconds ? <> · <span className="tnum">{tc(c.durationSeconds)}</span></> : null}
                    {" · "}
                    {ago(c.at)}
                  </p>
                  <p className="mt-1.5 truncate text-[15px] font-semibold leading-snug underline-offset-4 group-hover:underline">{c.title}</p>
                  <p className="truncate text-small text-fg-3">{c.sub}</p>
                  {c.badge && c.badge.tone !== "ready" ? (
                    <p className={`mt-2 inline-flex items-center gap-2 font-mono text-label uppercase tracking-[.08em] ${c.badge.tone === "bad" ? "text-err" : "text-tally-ink"}`}>
                      {c.badge.tone === "live" ? <Tally /> : c.badge.tone === "wait" ? <Tally blink /> : null}
                      <span className="tnum">{c.badge.text}</span>
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
