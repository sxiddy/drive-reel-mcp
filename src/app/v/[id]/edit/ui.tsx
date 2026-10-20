"use client";

import { useSyncExternalStore } from "react";

export const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-brand/70 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60";

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-white/[0.06] px-4 py-4 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex justify-between gap-2 text-xs text-white/70">
        <span className="truncate">{label}</span>
        {hint ? <span className="shrink-0 tabular-nums text-muted">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Slider(props: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  const pct = ((props.value - props.min) / Math.max(1e-6, props.max - props.min)) * 100;
  return (
    <input
      type="range"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(Number(e.target.value))}
      className="slider w-full disabled:cursor-not-allowed disabled:opacity-40"
      style={{ ["--pct" as string]: `${Math.max(0, Math.min(100, pct))}%` }}
    />
  );
}

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid size-9 shrink-0 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Segmented tab bar used by the side panels and the phone bottom sheet. */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-white/[0.06] px-2 py-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            value === t.id ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white/90"
          }`}
        >
          {t.icon}
          <span className="truncate">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export const fmtSecs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`);

/** Which editor layout fits the window: three columns, stage + side panel, or phone (bottom sheet). */
export type LayoutMode = "wide" | "mid" | "narrow";
const mq = (q: string) => (typeof window !== "undefined" ? window.matchMedia(q) : null);
function subscribe(cb: () => void) {
  const a = mq("(min-width: 1100px)");
  const b = mq("(min-width: 768px)");
  a?.addEventListener("change", cb);
  b?.addEventListener("change", cb);
  return () => {
    a?.removeEventListener("change", cb);
    b?.removeEventListener("change", cb);
  };
}
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(
    subscribe,
    () => (mq("(min-width: 1100px)")?.matches ? "wide" : mq("(min-width: 768px)")?.matches ? "mid" : "narrow"),
    () => "wide",
  );
}
