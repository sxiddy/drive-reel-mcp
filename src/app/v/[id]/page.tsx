import crypto from "node:crypto";
import fs from "node:fs";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { type AspectRatio, type EditPlan } from "@/shared/plan";
import { STYLES } from "@/shared/styles";
import { downloadName, ensureOgImage, file720, fileBytes, OG_SIZE, size720, versionSize } from "@/src/lib/renditions";
import { isVideoId, jobView, latest, readMeta, readPlan, readVersionPlan, recoverStaleRender, safeJoin, videoDir, type Version, type VideoMeta } from "@/src/lib/store";
import { DeliveryProvider, DownloadMenu, FormatSwitcher, RenderJobs, ShareRow, type DownloadInfo, type FormatSlot } from "./Delivery";
import { EditButton } from "./EditButton";
import { Room } from "../../_ui/Room";
import { Reel } from "../../_ui/Reel";
import { Label, btn, tc, wrap } from "../../_ui/kit";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> };

/** The selected version with the plan it was rendered from (the current plan for legacy versions without a snapshot). */
function load(id: string, v: string | undefined) {
  const raw = isVideoId(id) ? readMeta(id) : null;
  if (!raw) return null;
  const meta = recoverStaleRender(raw);
  const current = readPlan(id);
  const version = meta.versions.find((x) => String(x.n) === v) ?? latest(meta);
  const snapshot = readVersionPlan(id, version);
  const plan: EditPlan = snapshot ?? current;
  const aspect: AspectRatio = version.aspect ?? plan.aspect;
  return { meta, version, plan, aspect, hasSnapshot: !!snapshot };
}

/** Absolute site origin: SITE_URL, or the request's own host (behind a proxy too). */
async function origin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

const describe = (meta: VideoMeta) => meta.pitch ?? `${meta.themeName} · ${meta.occasion}. Made by Claude from Google Drive footage.`;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const { v } = await searchParams;
  const data = load(id, v);
  if (!data) return { title: "Not in the can · It's a Wrap" };
  const { meta, version, aspect } = data;
  const base = await origin();
  const size = versionSize(version, aspect);
  const description = describe(meta);
  // A 1200x630 card made from the poster (portrait reels get a blurred fill), so every share shows a proper wide preview.
  let image = { url: `${base}/media/${id}/${version.poster}`, ...size };
  try {
    image = { url: `${base}/media/${id}/${await ensureOgImage(id, version)}`, ...OG_SIZE };
  } catch {
    /* fall back to the poster at its real size */
  }
  const video = `${base}/media/${id}/${version.file}`;
  const url = `${base}/v/${id}${v ? `?v=${version.n}` : ""}`;
  const secure = video.startsWith("https:");
  return {
    metadataBase: new URL(base),
    title: `${meta.title} · It's a Wrap`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.other",
      siteName: "It's a Wrap",
      title: meta.title,
      description,
      url,
      images: [{ url: image.url, secureUrl: secure ? image.url : undefined, width: image.width, height: image.height, type: "image/jpeg", alt: `${meta.title}: ${meta.themeName}` }],
      videos: [{ url: video, secureUrl: secure ? video : undefined, type: "video/mp4", width: size.width, height: size.height }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description, images: [{ url: image.url, alt: `${meta.title}: ${meta.themeName}` }] },
  };
}

/** Fingerprint of an edit regardless of frame shape, so the 16:9 and 9:16 renders of one edit group together. */
function editHash(id: string, v: Version): string | null {
  const plan = readVersionPlan(id, v);
  if (!plan) return null;
  const { aspect: _a, assetBase: _b, ...rest } = plan;
  void _a;
  void _b;
  return crypto.createHash("sha1").update(JSON.stringify(rest)).digest("hex");
}

/** Per frame shape, the latest render of the selected version's edit, else the latest render of that shape at all. */
function formatSlots(id: string, meta: VideoMeta, version: Version, aspect: AspectRatio): FormatSlot[] {
  const hashes = new Map(meta.versions.map((x) => [x.n, editHash(id, x)]));
  const mine = hashes.get(version.n);
  return (["16:9", "9:16", "1:1"] as const).map((a) => {
    if (a === aspect) return { aspect: a, n: version.n };
    const ofShape = meta.versions.filter((x) => x.aspect === a).reverse();
    const same = mine ? ofShape.find((x) => hashes.get(x.n) === mine) : undefined;
    if (same) return { aspect: a, n: same.n };
    if (ofShape[0]) return { aspect: a, n: ofShape[0].n, earlierEdit: true };
    return { aspect: a, n: null };
  });
}

function downloads(id: string, meta: VideoMeta, v: Version, aspect: AspectRatio, hasSnapshot: boolean): DownloadInfo {
  const url = (file: string, q: string) => `/media/${id}/${file}?download=${encodeURIComponent(downloadName(meta.title, v.n, aspect, q))}`;
  const sdFile = file720(v);
  let sdReady = false;
  try {
    sdReady = fs.statSync(safeJoin(videoDir(id), sdFile)).size > 0;
  } catch {
    /* made on first download */
  }
  const uhdOk = v.uhd && fileBytes(id, v.uhd.file) !== null;
  return {
    n: v.n,
    aspect,
    hd: { url: url(v.file, "1080p"), ...versionSize(v, aspect), bytes: fileBytes(id, v.file) },
    sd: { ...size720({ ...v, aspect }), url: sdReady ? url(sdFile, "720p") : null, bytes: sdReady ? fileBytes(id, sdFile) : null },
    uhd: uhdOk && v.uhd ? { url: url(v.uhd.file, "4k"), width: v.uhd.width, height: v.uhd.height, bytes: fileBytes(id, v.uhd.file) } : null,
    canMakeUhd: hasSnapshot,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export default async function Watch({ params, searchParams }: Props) {
  const { id } = await params;
  const { v } = await searchParams;
  const data = load(id, v);
  if (!data) notFound();
  const { meta, version, plan, aspect, hasSnapshot } = data;
  const portrait = aspect === "9:16";
  const square = aspect === "1:1";
  const base = await origin();
  const isLatest = version.n === latest(meta).n;
  const shareUrl = `${base}/v/${id}${isLatest ? "" : `?v=${version.n}`}`;
  const prev = [...meta.versions].reverse().find((x) => x.n < version.n);
  const compareHref = meta.versions.length > 1 ? `/v/${id}/compare?a=${(prev ?? meta.versions.find((x) => x.n !== version.n))!.n}&b=${version.n}` : null;
  const take = (x: Version) => `Take ${x.n}${x.n === 1 ? " · Claude's cut" : x.from ? ` · from take ${x.from}` : ""}`;
  return (
    <Room tone="dark">
      <main className="flex-1 pb-28 pt-6 sm:pt-10 lg:pb-24">
        <DeliveryProvider id={id} initialJobs={(meta.jobs ?? []).map((j) => jobView(id, j))}>
          <div className={`${wrap} grid gap-10 lg:grid-cols-12 lg:gap-6`}>
            <div className={`min-w-0 ${portrait ? "lg:col-span-4" : square ? "lg:col-span-5" : "lg:col-span-8"}`}>
              <div className={portrait || square ? "" : "-mx-4 sm:mx-0"} style={portrait ? { width: "min(100%, calc(80dvh * 9 / 16))", marginInline: "auto" } : undefined}>
                <Reel
                  key={version.file}
                  src={`/media/${id}/${version.file}`}
                  poster={`/media/${id}/${version.poster}`}
                  aspect={aspect.replace(":", " / ")}
                  code={`IAW·${id.slice(0, 6)} ▸ Take ${version.n} · ${aspect}`}
                />
              </div>
            </div>

            <aside className={`min-w-0 lg:border-l lg:border-line lg:pl-6 ${portrait ? "lg:col-span-8" : square ? "lg:col-span-7" : "lg:col-span-4"}`}>
              <Label className="text-fg-3">{meta.occasion}</Label>
              <h1 className="display mt-2 break-words text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
                {meta.title}
              </h1>
              <p className="mt-3 font-mono text-label uppercase tracking-[.08em] text-fg-2 tnum">
                {plan.themeName} · {STYLES[plan.styleId].name} · {aspect} · {tc(version.durationSeconds)} · {plan.scenes.length} shots · Take {version.n}
              </p>
              {plan.music?.credit && plan.music.credit !== "Generated soundtrack" ? (
                <p className="mt-2 whitespace-pre-line text-caption text-fg-3">Music: {plan.music.credit}</p>
              ) : null}
              {meta.pitch ? <p className="mt-5 max-w-[62ch] font-serif text-prose text-fg">{meta.pitch}</p> : null}

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <EditButton id={id} />
                <DownloadMenu info={downloads(id, meta, version, aspect, hasSnapshot)} />
                {compareHref ? (
                  <Link href={compareHref} className={btn("ghost", "md")}>
                    Compare
                  </Link>
                ) : null}
              </div>

              <div className="mt-8 space-y-8 border-t border-line pt-6">
                <FormatSwitcher slots={formatSlots(id, meta, version, aspect)} current={version.n} from={hasSnapshot ? version.n : null} />

                <RenderJobs />

                <ShareRow url={shareUrl} title={meta.title} text={describe(meta)} />

                {meta.story || meta.occasionFit ? (
                  <section>
                    <Label as="h2" className="text-fg-3">How it was cut</Label>
                    <dl className="mt-3 grid gap-4">
                      {meta.story ? (
                        <div>
                          <Label as="dt" className="text-fg-2">Story</Label>
                          <dd className="mt-1 font-serif text-prose text-fg">{meta.story}</dd>
                        </div>
                      ) : null}
                      {meta.occasionFit ? (
                        <div>
                          <Label as="dt" className="text-fg-2">Why it fits</Label>
                          <dd className="mt-1 font-serif text-prose text-fg">{meta.occasionFit}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>
                ) : null}

                {meta.versions.length > 1 ? (
                  <section>
                    <div className="flex items-center justify-between">
                      <Label as="h2" className="text-fg-3">
                        Takes · <span className="tnum">{pad2(meta.versions.length)}</span>
                      </Label>
                      {compareHref ? (
                        <Link href={compareHref} className="text-caption text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                          Compare before/after
                        </Link>
                      ) : null}
                    </div>
                    <ul className="mt-2 border-t border-line">
                      {[...meta.versions].reverse().map((x) => (
                        <li key={x.n} className="border-b border-line">
                          <Link
                            href={`/v/${id}?v=${x.n}`}
                            aria-current={x.n === version.n ? "page" : undefined}
                            className={`flex items-center justify-between gap-3 px-2 py-2.5 text-small ${x.n === version.n ? "bg-surface text-fg" : "text-fg-2 hover:bg-surface hover:text-fg"}`}
                          >
                            <span className="min-w-0 truncate">{take(x)}</span>
                            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tnum">
                              {x.uhd ? <span className="border border-edge px-1">4K</span> : null}
                              {x.aspect ? <span className="border border-line px-1">{x.aspect}</span> : null}
                              <span className="text-fg-3">{new Date(x.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {meta.source && /^https?:/.test(meta.source) ? (
                  <p className="text-caption text-fg-3">
                    Source:{" "}
                    <a href={meta.source} className="underline decoration-edge underline-offset-4 hover:text-fg" target="_blank" rel="noreferrer">
                      {meta.source.includes("drive.google") ? "Google Drive folder" : meta.source}
                    </a>
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </DeliveryProvider>
      </main>
    </Room>
  );
}
