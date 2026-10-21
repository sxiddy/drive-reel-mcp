"use client";

import { useCallback, useEffect, useState } from "react";
import { Label, Tally, btn } from "../_ui/kit";

type Job = {
  id: string;
  createdAt: string;
  updatedAt: string;
  step: string;
  stage: string;
  progress: number;
  error?: string;
  input: { source: string; occasion: string; duration: number };
  stats?: { clips: number; photos: number };
  chosen?: string;
  videoId?: string;
  footageCleared: boolean;
};
type Video = { id: string; title: string; createdAt: string; versions: number; occasion: string };

const KEY = "itsawrap:admin";
const RUNNING = ["queued", "analyzing", "themes", "rendering"];
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Owner view of every job and video. The token stays in this tab (sessionStorage) and is sent only to /api/admin. */
export function AdminBoard() {
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<{ jobs: Job[]; videos: Video[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY));
    } catch {}
  }, []);

  const load = useCallback(async (t: string) => {
    const r = await fetch("/api/admin/jobs", { headers: { authorization: `Bearer ${t}` }, cache: "no-store" });
    if (r.status === 401) {
      setError("That token is wrong.");
      setToken(null);
      try {
        sessionStorage.removeItem(KEY);
      } catch {}
      return;
    }
    if (!r.ok) return setError(`Couldn't load (${r.status}).`);
    setError(null);
    setData(await r.json());
  }, []);

  useEffect(() => {
    if (!token) return;
    void load(token);
    const t = setInterval(() => void load(token), 5000);
    return () => clearInterval(t);
  }, [token, load]);

  if (!token) {
    return (
      <form
        className="mt-16 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          try {
            sessionStorage.setItem(KEY, t);
          } catch {}
          setToken(t);
          setDraft("");
        }}
      >
        <h1 className="display text-d2">Admin</h1>
        <p className="mt-3 text-fg-2">Enter the site&rsquo;s publish token to see every job.</p>
        <input
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Publish token"
          className="mt-6 w-full rounded-md border border-line bg-transparent px-3 py-2 font-mono text-sm"
        />
        {error ? <p className="mt-2 text-sm text-err">{error}</p> : null}
        <button className={btn("primary", "md", "mt-4")}>Open</button>
      </form>
    );
  }

  const running = data?.jobs.filter((j) => RUNNING.includes(j.step)).length ?? 0;
  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-d2">Admin</h1>
          <p className="mt-2 text-fg-2">
            {data ? `${data.jobs.length} jobs · ${running} running · ${data.videos.length} published videos` : "Loading…"} · refreshes every 5s
          </p>
        </div>
        <button
          className={btn("ghost", "md")}
          onClick={() => {
            try {
              sessionStorage.removeItem(KEY);
            } catch {}
            setToken(null);
            setData(null);
          }}
        >
          Lock
        </button>
      </div>
      {error ? <p className="mt-4 text-sm text-err">{error}</p> : null}

      <Label as="h2" className="mt-10">Jobs</Label>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-fg-2">
            <tr className="border-b border-line">
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Occasion</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Drive link</th>
              <th className="py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {data?.jobs.map((j) => (
              <tr key={j.id} className="border-b border-line align-top">
                <td className="py-2 pr-4 font-mono whitespace-nowrap">{when(j.createdAt)}</td>
                <td className="py-2 pr-4">
                  {j.input.occasion}
                  <span className="block text-fg-2">
                    {j.input.duration}s{j.chosen ? ` · ${j.chosen}` : ""}
                    {j.stats ? ` · ${j.stats.clips} clips, ${j.stats.photos} photos` : ""}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-2">
                    {RUNNING.includes(j.step) ? <Tally blink /> : null}
                    {j.step}
                    {RUNNING.includes(j.step) ? ` ${Math.round(j.progress * 100)}%` : ""}
                  </span>
                  <span className="block text-fg-2">{j.error ?? j.stage}</span>
                  {j.footageCleared ? <span className="block text-fg-2">footage cleared</span> : null}
                </td>
                <td className="max-w-[260px] truncate py-2 pr-4">
                  <a href={j.input.source} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                    {j.input.source.replace(/^https:\/\//, "")}
                  </a>
                </td>
                <td className="py-2 whitespace-nowrap">
                  <a href={`/make/${j.id}`} className="underline underline-offset-2">
                    job
                  </a>
                  {j.videoId ? (
                    <>
                      {" · "}
                      <a href={`/v/${j.videoId}`} className="underline underline-offset-2">
                        video
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Label as="h2" className="mt-12">Published videos</Label>
      <ul className="mt-3 divide-y divide-line text-sm">
        {data?.videos.map((v) => (
          <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
            <a href={`/v/${v.id}`} className="underline underline-offset-2">
              {v.title}
            </a>
            <span className="font-mono text-fg-2">
              {v.occasion} · {v.versions} version{v.versions === 1 ? "" : "s"} · {when(v.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
