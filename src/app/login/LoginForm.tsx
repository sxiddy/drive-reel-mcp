"use client";

import { useState } from "react";
import { btn } from "../_ui/kit";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-20 max-w-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
        setBusy(false);
        if (r.ok) return void window.location.assign(next);
        setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in.");
      }}
    >
      <h1 className="display text-d2">It&rsquo;s a Wrap</h1>
      <p className="mt-3 text-fg-2">This site is private. Enter the password you were given.</p>
      <input
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label="Password"
        className="mt-6 h-12 w-full rounded-xs border border-edge bg-surface px-3 text-body outline-none focus:border-fg"
      />
      {error ? (
        <p role="alert" className="mt-3 text-small text-err">
          {error}
        </p>
      ) : null}
      <button disabled={busy || !password} className={btn("primary", "lg", "mt-5 w-full")}>
        {busy ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}
