"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readMakes } from "../history";
import { Tally, btn, wrap } from "./kit";

/** 16x12 slate: striped clapstick over an ink box. */
export function SlateGlyph({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-flex h-3 w-4 flex-col ${className}`}>
      <span className="slate-stripes h-[4px] w-full border border-fg" />
      <span className="mt-px w-full flex-1 bg-fg" />
    </span>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [rolling, setRolling] = useState<{ n: number; href: string } | null>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // Jobs started in this browser that the worker is still running.
  useEffect(() => {
    let live = true;
    (async () => {
      const open = readMakes().filter((m) => !m.videoId).slice(0, 4);
      const busy: string[] = [];
      for (const m of open) {
        const r = await fetch(`/api/make/${m.id}`, { cache: "no-store" }).catch(() => null);
        const s = r?.ok ? await r.json().catch(() => null) : null;
        if (s && ["queued", "analyzing", "themes", "rendering"].includes(s.step)) busy.push(m.id);
      }
      if (live) setRolling(busy.length ? { n: busy.length, href: `/make/${busy[0]}` } : null);
    })();
    return () => {
      live = false;
    };
  }, [path]);

  return (
    <header className={`sticky top-0 z-30 border-b bg-canvas transition-colors duration-(--f2) ${scrolled ? "border-line" : "border-transparent"}`}>
      <div className={`${wrap} flex h-13 items-center justify-between gap-3 sm:h-14`}>
        <Link href="/" className="flex items-center gap-2.5" aria-label="It's a Wrap, home">
          <SlateGlyph />
          <span className="display text-[20px] leading-none tracking-[.01em]">It&rsquo;s a Wrap</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {rolling && !path.startsWith("/make/") ? (
            <Link href={rolling.href} className="mr-1 inline-flex h-8 items-center gap-2 rounded-xs border border-line px-2.5 font-mono text-label uppercase tracking-[.08em] text-tally-ink hover:border-edge">
              <Tally /> {rolling.n} rolling
            </Link>
          ) : null}
          <Link href="/#videos" className={btn("ghost", "sm")}>
            Your videos
          </Link>
          {path !== "/" ? (
            <Link href="/" className={btn("secondary", "sm", "hidden sm:inline-flex")}>
              New video
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
