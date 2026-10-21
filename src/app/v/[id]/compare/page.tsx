import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isVideoId, latest, readMeta } from "@/src/lib/store";
import { versionSize } from "@/src/lib/renditions";
import { Compare, type CompareVersion } from "./Compare";
import { Room } from "../../../_ui/Room";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; mode?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  return { title: meta ? `Compare versions · ${meta.title} · It's a Wrap` : "It's a Wrap", robots: { index: false } };
}

/** Before/after: two versions side by side or under a wipe, kept in sync. Defaults to the previous and the latest. */
export default async function ComparePage({ params, searchParams }: Props) {
  const { id } = await params;
  const q = await searchParams;
  const meta = isVideoId(id) ? readMeta(id) : null;
  if (!meta || !meta.versions.length) notFound();
  const versions: CompareVersion[] = meta.versions.map((v) => ({
    n: v.n,
    src: `/media/${id}/${v.file}`,
    poster: `/media/${id}/${v.poster}`,
    aspect: v.aspect ?? "16:9",
    ...versionSize(v),
    durationSeconds: v.durationSeconds,
    createdAt: v.createdAt,
    label: v.n === 1 ? "Claude's cut" : v.from ? `${v.aspect} of v${v.from}` : undefined,
  }));
  const find = (s: string | undefined) => versions.find((v) => String(v.n) === s);
  const b = find(q.b) ?? versions.find((v) => v.n === latest(meta).n)!;
  const a = find(q.a) ?? [...versions].reverse().find((v) => v.n < b.n) ?? versions.find((v) => v.n !== b.n) ?? b;
  return (
    <Room tone="dark">
      <div className="flex-1">
        <Compare id={id} title={meta.title} versions={versions} initialA={a.n} initialB={b.n} initialMode={q.mode === "side" ? "side" : q.mode === "wipe" ? "wipe" : undefined} />
      </div>
    </Room>
  );
}
