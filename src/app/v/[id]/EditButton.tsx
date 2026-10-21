"use client";

import { Eye, Scissors } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { checkEditKey, readStoredKey } from "@/src/lib/editKey";
import { btn } from "../../_ui/kit";

/** "Edit" only for browsers holding this video's edit key; everyone else sees a quiet "View only". */
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

  if (state === "checking") return <span className="h-10 w-[92px] rounded-xs border border-line" aria-hidden />;
  if (state === "view") {
    return (
      <span className="inline-flex h-10 items-center gap-1.5 px-2 text-small text-fg-3" title="Open the edit link Claude gave you to make changes">
        <Eye size={16} strokeWidth={1.5} aria-hidden />
        View only
      </span>
    );
  }
  return (
    <Link href={`/v/${id}/edit`} className={btn("primary", "md")}>
      <Scissors size={16} strokeWidth={1.5} aria-hidden />
      Edit
    </Link>
  );
}
