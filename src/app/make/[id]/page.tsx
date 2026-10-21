import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isMakeId } from "@/shared/make";
import { Room } from "../../_ui/Room";
import { wrap } from "../../_ui/kit";
import { MakeProgress } from "./MakeProgress";

export const metadata: Metadata = { title: "Making your video · It's a Wrap", robots: { index: false } };

export default async function MakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMakeId(id)) notFound();
  return (
    <Room tone="office">
      <main className={`${wrap} flex-1 pb-24`}>
        <MakeProgress id={id} />
      </main>
    </Room>
  );
}
