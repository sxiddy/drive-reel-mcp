"use client";

import { useState } from "react";

export function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href.split("?")[0]);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg border border-line px-4 py-2.5 hover:border-white/40"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
