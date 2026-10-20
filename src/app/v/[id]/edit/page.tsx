import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadMedia } from "@/src/lib/media";
import { ensureEditKey, isVideoId, readMeta, readPlan, recoverStaleRender, renderView } from "@/src/lib/store";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = isVideoId(id) ? readMeta(id) : null;
  return { title: meta ? `Edit · ${meta.title} · Drive Reel` : "Drive Reel", robots: { index: false } };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = isVideoId(id) ? readMeta(id) : null;
  if (!raw) notFound();
  // Legacy videos get an edit key now (printed to the server console) so they aren't left open.
  ensureEditKey(id);
  const meta = recoverStaleRender(raw);
  const plan = readPlan(id);
  return <Editor id={id} initialPlan={plan} initialVersions={meta.versions.length} initialRender={renderView(meta)} initialMedia={loadMedia(id, plan)} />;
}
