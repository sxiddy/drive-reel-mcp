import Link from "next/link";
import { latest, listVideos } from "@/src/lib/store";

export const dynamic = "force-dynamic";

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export default function Home() {
  const videos = listVideos();
  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6">
      <section className="mb-12 max-w-2xl">
        <h1 className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Footage in. <span className="italic text-brand">Finished video</span> out.
        </h1>
        <p className="mt-4 text-lg text-muted">
          Share a Google Drive folder with Claude, pick one of the themes it suggests, and the edited video lands here, ready to watch, share or fine-tune.
        </p>
      </section>

      {videos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          <p className="text-lg text-white">No videos yet</p>
          <p className="mt-2 text-sm">
            In Claude, ask: <span className="text-white">&ldquo;Make a 45-second aftermovie from this Drive folder: …&rdquo;</span>
          </p>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => {
            const cur = latest(v);
            const aspect = cur.aspect; // unknown for versions rendered before snapshots
            return (
              <li key={v.id}>
                <Link href={`/v/${v.id}`} className="group block">
                  <div className="relative aspect-video overflow-hidden rounded-xl border border-line bg-panel">
                    {/* Portrait and square reels sit uncropped on a blurred copy of their own poster. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/media/${v.id}/${cur.poster}`} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl brightness-75" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/media/${v.id}/${cur.poster}`}
                      alt=""
                      loading="lazy"
                      className={`relative size-full object-contain transition duration-500 group-hover:scale-[1.03] ${aspect === "16:9" ? "" : "drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]"}`}
                    />
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs tabular-nums">{Math.round(cur.durationSeconds)}s</span>
                    {aspect && aspect !== "16:9" ? <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white/80">{aspect}</span> : null}
                    {v.versions.length > 1 ? <span className="absolute left-2 top-2 rounded bg-brand px-1.5 py-0.5 text-xs font-medium text-ink">v{cur.n}</span> : null}
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium group-hover:text-brand">{v.title}</p>
                      <p className="truncate text-sm text-muted">
                        {v.themeName} · {v.occasion}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{ago(v.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
