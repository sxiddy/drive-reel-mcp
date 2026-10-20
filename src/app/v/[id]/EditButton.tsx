"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkEditKey, readStoredKey } from "@/src/lib/editKey";

/** "Edit video" only for browsers holding this video's edit key; everyone else sees a quiet "View only". */
export function EditButton({ id }: { id: string }) {
  const [state, setState] = useState<"checking" | "edit" | "view">("checking");
  useEffect(() => {
    const key = readStoredKey(id);
    if (!key) {
      setState("view");
      return;
    }
    let live = true;
    checkEditKey(id, key).then((ok) => live && setState(ok ? "edit" : "view"));
    return () => {
      live = false;
    };
  }, [id]);

  if (state === "checking") return <span className="h-[42px] w-[118px] animate-pulse rounded-lg bg-panel" aria-hidden />;
  if (state === "view") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2.5 text-sm text-muted" title="Open the edit link Claude gave you to make changes">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        View only
      </span>
    );
  }
  return (
    <Link href={`/v/${id}/edit`} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-medium text-ink hover:brightness-110">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
      </svg>
      Edit video
    </Link>
  );
}
