import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadMedia } from "@/src/lib/media";
import { ensureEditKey, isVideoId, readMeta, readPlan, recoverStaleRender, renderView } from "@/src/lib/store";
import { Editor } from "./Editor";
import { Room } from "../../../_ui/Room";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  return { title: meta ? `Edit · ${meta.title} · It's a Wrap` : "It's a Wrap", robots: { index: false } };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = isVideoId(id) ? readMeta(id) : null;
  if (!raw) notFound();
  // Legacy videos get an edit key now (printed to the server console) so they aren't left open.
  ensureEditKey(id);
  const meta = recoverStaleRender(raw);
  const plan = readPlan(id);
  return (
    <Room tone="dark" footer={false}>
      <Editor id={id} initialPlan={plan} initialVersions={meta.versions.map(({ n, aspect, createdAt, durationSeconds, poster, uhd, from }) => ({ n, aspect, createdAt, durationSeconds, poster, uhd: uhd ? true : undefined, from }))} initialRender={renderView(meta)} initialMedia={loadMedia(id, plan)} />
    </Room>
  );
}
