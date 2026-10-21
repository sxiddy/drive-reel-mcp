"use client";

import { useEffect, useRef, useState } from "react";
import { tc } from "./kit";

/** The film in a frame: #000 letterbox, native controls, and the edge code underneath. */
export function Reel({
  src,
  poster,
  code,
  autoPlay = false,
  aspect = "16 / 9",
  className = "",
}: {
  src: string;
  poster?: string;
  code: string;
  autoPlay?: boolean;
  aspect?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const on = () => setT(v.currentTime);
    v.addEventListener("timeupdate", on);
    v.addEventListener("seeked", on);
    return () => {
      v.removeEventListener("timeupdate", on);
      v.removeEventListener("seeked", on);
    };
  }, [src]);
  return (
    <figure className={className}>
      <div className="border border-line bg-black" style={{ aspectRatio: aspect }}>
        <video ref={ref} src={src} poster={poster} controls autoPlay={autoPlay} muted={autoPlay} playsInline className="size-full" />
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-4 px-4 font-mono text-caption text-fg-3 sm:px-0">
        <span className="truncate uppercase">{code}</span>
        <span className="tnum shrink-0" aria-hidden>
          {tc(t, true)}
        </span>
      </figcaption>
    </figure>
  );
}
