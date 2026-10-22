"use client";

import { Check, Folder } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, ViewTransition } from "react";
import { rememberMake } from "./history";
import { Label, Tally, btn, tc } from "./_ui/kit";

const LENGTHS = [15, 30, 45, 60, 90];
const OCCASIONS = ["Hackathon aftermovie", "Birthday", "Wedding", "College fest", "Trip recap", "Product launch", "Sports day", "Farewell"];

const isDrive = (s: string) => /^https:\/\/(drive|docs)\.google\.com\//.test(s.trim());

/** `drive.google.com / folders / 1aB…xZ`: what we read from the link, so you can check it. */
function readout(s: string) {
  try {
    const u = new URL(s.trim());
    const parts = u.pathname.split("/").filter(Boolean).filter((p) => p !== "drive" && p !== "u" && !/^\d$/.test(p));
    const tail = parts.map((p) => (p.length > 12 ? `${p.slice(0, 3)}…${p.slice(-2)}` : p));
    return [u.hostname, ...tail].join(" / ");
  } catch {
    return "";
  }
}

/** The call sheet: three ruled rows and one click. */
export function CreateForm() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [checked, setChecked] = useState(""); // the link value validation has caught up with
  const [duration, setDuration] = useState(30);
  const [occasion, setOccasion] = useState("");
  // Optional, but they make the title and end card read like a real event ("VinHack 2026 · VIT Vellore").
  const [eventName, setEventName] = useState("");
  const [place, setPlace] = useState("");
  // An uploaded song means "our own song"; without one the library is used (a song in the folder still counts).
  const [song, setSong] = useState<{ id: string; name: string; url: string; duration?: number; bpm?: number } | null>(null);
  const [songBusy, setSongBusy] = useState(false);
  const [matchSong, setMatchSong] = useState(false);
  const [dragging, setDragging] = useState(false);

  function removeSong() {
    if (song) URL.revokeObjectURL(song.url);
    setSong(null);
  }

  async function uploadSong(file: File) {
    setError(null);
    if (file.size > 40 * 1024 * 1024) return setError("Songs can be up to 40 MB.");
    setSongBusy(true);
    try {
      const res = await fetch("/api/make/song", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status}).`);
      setSong({ id: j.songId, name: file.name, url: URL.createObjectURL(file), duration: j.duration, bpm: j.bpm });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSongBusy(false);
    }
  }
  const [sweep, setSweep] = useState(0);
  const [busy, setBusy] = useState<null | "themes" | "auto">(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // While typing, judge the link 400ms after the last key; a paste is judged at once.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setChecked(link), 400);
    return () => clearTimeout(timer.current);
  }, [link]);

  const shown = checked === link ? link : checked;
  const linkOk = shown.trim() !== "" && isDrive(shown);
  const linkBad = shown.trim() !== "" && !isDrive(shown);
  const ready = isDrive(link) && occasion.trim().length >= 2;

  async function start(auto: boolean) {
    if (!ready || busy) return;
    setBusy(auto ? "auto" : "themes");
    setError(null);
    try {
      const res = await fetch("/api/make", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: link.trim(), duration, occasion: occasion.trim(), eventName: eventName.trim() || undefined, place: place.trim() || undefined, music: song ? "own" : "library", songId: song?.id, matchSong: song ? matchSong : undefined, auto }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Something went wrong (${res.status}).`);
      rememberMake({ id: j.id, occasion: occasion.trim(), createdAt: j.createdAt });
      startTransition(() => router.push(`/make/${j.id}`));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const row = "grid gap-3 border-t border-line px-4 py-5 sm:px-6 md:grid-cols-[112px_1fr] md:gap-4";

  return (
    <MotionConfig reducedMotion="user">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(false);
        }}
        className="relative border border-line bg-surface"
        aria-label="Call sheet"
      >
        <ViewTransition name="slate" share="morph">
          <div className="flex items-center justify-between bg-fg px-4 py-2.5 text-canvas sm:px-6">
            <Label>Call sheet</Label>
            <Label className="tnum">Sc.01 / Take 1</Label>
          </div>
        </ViewTransition>

        <div className={row} style={{ borderTop: 0 }}>
          <label htmlFor="footage" className="pt-3.5">
            <Label as="span" className="text-fg-3">Footage</Label>
          </label>
          <div>
            <div className="relative flex h-12 items-center gap-2 rounded-xs border border-edge bg-surface px-3 focus-within:border-fg focus-within:shadow-[0_0_0_1px_var(--color-fg)]">
              {linkOk ? <span key={shown} aria-hidden className="bar-in absolute inset-y-0 left-0 w-[3px] bg-ok" /> : null}
              {linkOk ? <Check size={16} strokeWidth={1.5} className="shrink-0 text-ok" aria-hidden /> : <Folder size={16} strokeWidth={1.5} className="shrink-0 text-fg-3" aria-hidden />}
              <input
                id="footage"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onPaste={(e) => {
                  const v = e.clipboardData.getData("text");
                  requestAnimationFrame(() => setChecked((e.target as HTMLInputElement).value || v));
                }}
                placeholder="https://drive.google.com/drive/folders/…"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={linkBad}
                aria-describedby="footage-help"
                className="h-full w-full min-w-0 bg-transparent text-body outline-none placeholder:text-fg-3"
              />
            </div>
            <p id="footage-help" className={`mt-2 min-h-[1.2em] text-caption ${linkBad ? "text-err" : "text-fg-3"}`}>
              {linkBad ? (
                "That doesn’t look like a Google Drive link."
              ) : linkOk ? (
                <span key={shown} className="fade-in block truncate font-mono text-tc text-fg-2">{readout(shown)}</span>
              ) : (
                "Shared as “Anyone with the link”."
              )}
            </p>
          </div>
        </div>

        <fieldset className={row}>
          <legend className="sr-only">Runtime</legend>
          <Label as="span" className="pt-3.5 text-fg-3" >Runtime</Label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div role="radiogroup" aria-label="Runtime" className="flex bg-well p-1">
              {LENGTHS.map((s) => {
                const on = duration === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDuration(s)}
                    onKeyDown={(e) => {
                      const i = LENGTHS.indexOf(duration);
                      if (e.key === "ArrowRight" || e.key === "ArrowDown") setDuration(LENGTHS[Math.min(LENGTHS.length - 1, i + 1)]);
                      if (e.key === "ArrowLeft" || e.key === "ArrowUp") setDuration(LENGTHS[Math.max(0, i - 1)]);
                    }}
                    tabIndex={on ? 0 : -1}
                    className={`relative h-10 min-w-12 px-2 font-mono text-tc tnum transition-colors duration-(--f2) sm:min-w-14 ${on ? "text-on-primary" : "text-fg-2 hover:text-fg"}`}
                  >
                    {on ? <motion.span layoutId="runtime" transition={{ type: "spring", visualDuration: 0.21, bounce: 0 }} className="absolute inset-0 rounded-xs bg-primary" /> : null}
                    <span className="relative">{tc(s)}</span>
                  </button>
                );
              })}
            </div>
            <span className="relative inline-flex h-6 items-center overflow-hidden font-mono text-tc text-fg-3" aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={duration}
                  initial={{ y: "40%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1, transition: { duration: 0.125, ease: [0.22, 1, 0.36, 1] } }}
                  exit={{ y: "-40%", opacity: 0, transition: { duration: 0.083, ease: [0.64, 0, 0.78, 0] } }}
                  className="tnum"
                >
                  {duration} s · {duration * 24} frames
                </motion.span>
              </AnimatePresence>
            </span>
          </div>
        </fieldset>

        <div className={row}>
          <label htmlFor="occasion" className="pt-3.5">
            <Label as="span" className="text-fg-3">Occasion</Label>
          </label>
          <div>
            <div className="relative flex h-12 items-center rounded-xs border border-edge bg-surface px-3 focus-within:border-fg focus-within:shadow-[0_0_0_1px_var(--color-fg)]">
              {/* The highlighter pass sits under the text, matched to its width. */}
              {sweep ? (
                <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 overflow-hidden whitespace-pre text-body text-transparent">
                  <span key={sweep} className="sweep">{occasion}</span>
                </span>
              ) : null}
              <input
                id="occasion"
                value={occasion}
                onChange={(e) => setOccasion(e.target.value.slice(0, 80))}
                placeholder="e.g. VinHack 2026 aftermovie"
                className="relative h-full w-full min-w-0 bg-transparent text-body outline-none placeholder:text-fg-3"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {OCCASIONS.map((o) => {
                const on = occasion === o;
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setOccasion(o);
                      setSweep((n) => n + 1);
                    }}
                    className={`h-8 rounded-xs border px-3 text-small transition-colors duration-(--f2) ${on ? "border-fg bg-fg text-canvas" : "border-line text-fg-2 hover:border-edge hover:text-fg"}`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        </div>


        <div className={row}>
          <label htmlFor="eventName" className="pt-3.5">
            <Label as="span" className="text-fg-3">Event name · optional</Label>
          </label>
          <div>
            <div className="flex h-12 items-center rounded-xs border border-edge bg-surface px-3 focus-within:border-fg focus-within:shadow-[0_0_0_1px_var(--color-fg)]">
              <input
                id="eventName"
                value={eventName}
                onChange={(e) => setEventName(e.target.value.slice(0, 60))}
                placeholder="e.g. VinHack 2026"
                className="h-full w-full min-w-0 bg-transparent text-body outline-none placeholder:text-fg-3"
              />
            </div>
          </div>
        </div>

        <div className={row}>
          <label htmlFor="place" className="pt-3.5">
            <Label as="span" className="text-fg-3">Place · optional</Label>
          </label>
          <div>
            <div className="flex h-12 items-center rounded-xs border border-edge bg-surface px-3 focus-within:border-fg focus-within:shadow-[0_0_0_1px_var(--color-fg)]">
              <input
                id="place"
                value={place}
                onChange={(e) => setPlace(e.target.value.slice(0, 60))}
                placeholder="e.g. VIT Vellore"
                className="h-full w-full min-w-0 bg-transparent text-body outline-none placeholder:text-fg-3"
              />
            </div>
          </div>
        </div>

        <div className={row}>
          <Label as="span" className="pt-3.5 text-fg-3">Music · optional</Label>
          <div>
            {song ? (
              <div className="flex items-center gap-3 rounded-xs border border-edge bg-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-fg">{song.name}</p>
                  <p className="font-mono text-caption text-fg-3 tnum">
                    {song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, "0")}` : "–"}
                    {song.bpm ? ` · ${song.bpm} BPM` : ""}
                  </p>
                </div>
                <audio src={song.url} controls preload="none" className="h-8 w-40 shrink-0" />
                <button type="button" aria-label="Remove song" onClick={removeSong} className={btn("secondary", "sm", "shrink-0")}>
                  ×
                </button>
              </div>
            ) : null}
            {song ? (
              <label className="mt-2 flex items-center gap-2 text-small text-fg-2">
                <input type="checkbox" checked={matchSong} onChange={(e) => setMatchSong(e.target.checked)} />
                Match the song: make the video as long as the song, so it ends where the song ends
                {song.duration ? ` (${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, "0")})` : ""}
              </label>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) uploadSong(f);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-xs border border-dashed px-4 py-6 text-center ${dragging ? "border-fg bg-well" : "border-edge bg-surface"}`}
              >
                {songBusy ? (
                  <span className="text-small text-fg-2">
                    <Tally /> Uploading and finding the beat…
                  </span>
                ) : (
                  <>
                    <span className="text-small text-fg-2">Drop your song here (MP3, WAV, M4A, AAC or OGG, up to 40 MB)</span>
                    <label className={btn("secondary", "sm", "cursor-pointer")}>
                      Choose file
                      <input type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadSong(e.target.files[0])} />
                    </label>
                    <span className="text-caption text-fg-3">No song? We&apos;ll pick one from the royalty-free library (or use an audio file in your Drive folder).</span>
                  </>
                )}
              </div>
            )}
            <p className="mt-2 text-caption text-fg-3">Instagram or YouTube may mute or claim videos with copyrighted songs.</p>
          </div>
        </div>

        <div className="border-t border-line px-4 py-5 sm:px-6">
          {error ? (
            <p role="alert" className="fade-in mb-4 border-l-[3px] border-err bg-well px-3 py-2.5 text-small text-fg">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={!ready || busy !== null} className={btn("primary", "lg", "w-full")}>
            {busy === "themes" ? (
              <>
                <Tally /> Rolling…
              </>
            ) : (
              "Show me themes"
            )}
          </button>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <button type="button" onClick={() => start(true)} disabled={!ready || busy !== null} className={btn("secondary", "lg", "shrink-0")}>
              {busy === "auto" ? (
                <>
                  <Tally /> Rolling…
                </>
              ) : (
                "Just make it"
              )}
            </button>
            <p className="text-caption text-fg-2">Claude picks the strongest pitch and goes straight to the edit.</p>
          </div>
          <p className="mt-4 text-caption text-fg-3">Takes a few minutes. You can leave and come back.</p>
        </div>
      </form>
    </MotionConfig>
  );
}
