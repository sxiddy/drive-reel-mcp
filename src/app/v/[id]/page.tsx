import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DIMENSIONS, type AspectRatio, type EditPlan } from "@/shared/plan";
import { STYLES } from "@/shared/styles";
import { isVideoId, latest, readMeta, readPlan, readVersionPlan, recoverStaleRender, type VideoMeta } from "@/src/lib/store";
import { CopyLink } from "./CopyLink";
import { EditButton } from "./EditButton";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> };

/** The selected version with the plan it was rendered from (the current plan for legacy versions without a snapshot). */
function load(id: string, v: string | undefined) {
  const raw = isVideoId(id) ? readMeta(id) : null;
  if (!raw) return null;
  const meta = recoverStaleRender(raw);
  const current = readPlan(id);
  const version = meta.versions.find((x) => String(x.n) === v) ?? latest(meta);
  const plan: EditPlan = readVersionPlan(id, version) ?? current;
  const aspect: AspectRatio = version.aspect ?? plan.aspect;
  return { meta, version, plan, aspect };
}

/** Absolute site origin: SITE_URL, or the request's own host (behind a proxy too). */
async function origin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const { v } = await searchParams;
  const data = load(id, v);
  if (!data) return { title: "Video not found · Drive Reel" };
  const { meta, version, aspect } = data;
  const base = await origin();
  const { width, height } = DIMENSIONS[aspect];
  const description = meta.pitch ?? `${meta.themeName} · ${meta.occasion}. Made by Claude from Google Drive footage.`;
  const image = `${base}/media/${id}/${version.poster}`;
  const video = `${base}/media/${id}/${version.file}`;
  const url = `${base}/v/${id}${v ? `?v=${version.n}` : ""}`;
  return {
    metadataBase: new URL(base),
    title: `${meta.title} · Drive Reel`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.other",
      siteName: "Drive Reel",
      title: meta.title,
      description,
      url,
      images: [{ url: image, width, height, alt: meta.title }],
      videos: [{ url: video, secureUrl: video.startsWith("https:") ? video : undefined, type: "video/mp4", width, height }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description, images: [image] },
  };
}

const frameClass = (a: AspectRatio) => (a === "9:16" ? "aspect-[9/16]" : a === "1:1" ? "aspect-square" : "aspect-video");

export default async function Watch({ params, searchParams }: Props) {
  const { id } = await params;
  const { v } = await searchParams;
  const data = load(id, v);
  if (!data) notFound();
  const { meta, version, plan, aspect } = data;
  const portrait = aspect === "9:16";
  const square = aspect === "1:1";
  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <div className={`grid gap-8 ${portrait ? "lg:grid-cols-[minmax(0,420px)_1fr]" : square ? "lg:grid-cols-[minmax(0,640px)_1fr]" : "lg:grid-cols-[minmax(0,1fr)_340px]"}`}>
        <div className={portrait ? "mx-auto w-full max-w-[420px]" : square ? "mx-auto w-full max-w-[640px]" : "min-w-0"}>
          <video
            key={version.file}
            src={`/media/${id}/${version.file}`}
            poster={`/media/${id}/${version.poster}`}
            controls
            playsInline
            className={`w-full rounded-xl border border-line bg-black ${frameClass(aspect)}`}
            // Tall reels stay within the window instead of pushing the controls below the fold.
            style={portrait ? { width: "min(100%, calc(80dvh * 9 / 16))", marginInline: "auto", display: "block" } : undefined}
          />
        </div>

        <aside className="min-w-0 space-y-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">{meta.occasion}</p>
            <h1 className="mt-2 break-words font-display text-4xl leading-tight">{meta.title}</h1>
            <p className="mt-2 text-sm text-muted">
              {plan.themeName} · {STYLES[plan.styleId].name} style · {aspect} · {Math.round(version.durationSeconds)}s · {plan.scenes.length} shots
            </p>
            {meta.pitch ? <p className="mt-4 leading-relaxed text-white/80">{meta.pitch}</p> : null}
            {meta.story || meta.occasionFit ? (
              <dl className="mt-4 space-y-3 rounded-xl border border-line bg-white/[0.03] p-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">How Claude cut it</p>
                {meta.story ? (
                  <div>
                    <dt className="text-muted">Story</dt>
                    <dd className="mt-0.5 leading-relaxed text-white/85">{meta.story}</dd>
                  </div>
                ) : null}
                {meta.occasionFit ? (
                  <div>
                    <dt className="text-muted">Why it fits the occasion</dt>
                    <dd className="mt-0.5 leading-relaxed text-white/85">{meta.occasionFit}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <EditButton id={id} />
            <a
              href={`/media/${id}/${version.file}?download=${encodeURIComponent(`${meta.title}-v${version.n}.mp4`)}`}
              className="rounded-lg border border-line px-4 py-2.5 hover:border-white/40"
            >
              Download
            </a>
            <CopyLink />
          </div>

          <RenderNote meta={meta} />

          {meta.versions.length > 1 ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted">Versions</h2>
              <ul className="space-y-1">
                {[...meta.versions].reverse().map((x) => (
                  <li key={x.n}>
                    <Link
                      href={`/v/${id}?v=${x.n}`}
                      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${x.n === version.n ? "bg-panel text-white" : "text-muted hover:bg-panel/60"}`}
                    >
                      <span className="min-w-0 truncate">
                        Version {x.n}
                        {x.n === 1 ? " · Claude's cut" : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        {x.aspect ? <span className="rounded border border-line px-1 text-[10px]">{x.aspect}</span> : null}
                        {new Date(x.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {meta.source && /^https?:/.test(meta.source) ? (
            <p className="text-xs text-muted">
              Source:{" "}
              <a href={meta.source} className="underline decoration-line underline-offset-2 hover:text-white" target="_blank" rel="noreferrer">
                {meta.source.includes("drive.google") ? "Google Drive folder" : meta.source}
              </a>
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function RenderNote({ meta }: { meta: VideoMeta }) {
  if (meta.render.status === "rendering") {
    return (
      <p className="rounded-lg border border-line bg-panel p-3 text-sm text-muted">
        A new version is rendering ({Math.round(meta.render.progress * 100)}%). Refresh in a moment.
      </p>
    );
  }
  if (meta.render.status === "queued") {
    return <p className="rounded-lg border border-line bg-panel p-3 text-sm text-muted">A new version is queued and will render shortly.</p>;
  }
  return null;
}
