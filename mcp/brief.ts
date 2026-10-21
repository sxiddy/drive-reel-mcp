import fs from "node:fs";
import path from "node:path";
import { STYLES, STYLE_IDS } from "../shared/styles";
import { occasionProfile } from "../shared/occasions";
import { renderPreviewStill } from "../render/render";
import type { Analysis } from "./analyze";
import { buildPlan, type Theme, type ThemeInput } from "./planner";

/**
 * What Claude is told about a folder before it proposes themes. Shared by the MCP server (Claude
 * chat) and the website's own pipeline (Claude API), so both routes judge the footage the same way.
 */

export const styleCatalog = () =>
  STYLE_IDS.map((id) => {
    const s = STYLES[id];
    return `- ${id} ("${s.name}"): ${s.feel} Best for: ${s.bestFor}. ~${s.shotLength}s shots, ${s.music.bpm} BPM.`;
  }).join("\n");

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function occasionBrief(occasion: string) {
  const o = occasionProfile(occasion);
  return [
    `OCCASION: "${occasion}" reads as ${o.label}.`,
    `- Build most themes on: ${o.styles.join(", ")}${o.avoid.length ? `; avoid: ${o.avoid.join(", ")}` : ""}.`,
    `- Tone: ${o.tone}`,
    `- Caption ideas: ${o.captionIdeas}.`,
    "- Say in each theme's occasionFit why it suits this occasion. If the folder suggests the occasion is something else, tell the user.",
  ].join("\n");
}

const fmtMin = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** "dark or blurry from 12–15s" so Claude doesn't pick those moments by hand. */
function qualityNote(c: Analysis["clips"][number]) {
  if (!c.quality?.length) return "";
  const bad: [number, number][] = [];
  c.quality.forEach((q, i) => {
    if (q >= 0.4) return;
    const last = bad[bad.length - 1];
    if (last && last[1] === i * 0.5) last[1] = (i + 1) * 0.5;
    else bad.push([i * 0.5, (i + 1) * 0.5]);
  });
  if (!bad.length) return "";
  const share = Math.round((100 * bad.reduce((n, [a, b]) => n + b - a, 0)) / Math.max(0.5, c.duration));
  return ` · dark/blurry ${share}% (${bad.slice(0, 3).map(([a, b]) => `${a}–${b}s`).join(", ")})`;
}

/** The folder as text: every clip's stats, photos, songs, the style catalogue and the occasion brief. */
export function analysisSummary(a: Analysis): string {
  return [
    `Project ${a.projectId}. Occasion: "${a.occasion}". Target length: ${a.targetDuration}s. Suggested frame: ${a.suggestedAspect}.`,
    `Found ${a.clips.length} video clips (${Math.round(a.totals.footageSeconds)}s of footage), ${a.photos.length} photos, ${a.audio.length} audio tracks.`,
    a.skipped.length ? `Skipped: ${a.skipped.slice(0, 8).map((s) => `${s.name} (${s.reason})`).join("; ")}${a.skipped.length > 8 ? ` …and ${a.skipped.length - 8} more` : ""}` : "",
    "",
    "CLIPS (energy = loudness, motion = visual movement, both 0–1 relative to the folder; highlights = best windows in seconds):",
    ...a.clips.map(
      (c) =>
        `- ${c.id} · ${c.folder ? c.folder + "/" : ""}${c.name} · ${c.duration}s · ${c.orientation} · audio ${c.audioLevel} · energy ${avg(c.energy).toFixed(2)} · motion ${avg(c.motion).toFixed(2)}` +
        `${c.cuts.length ? ` · internal cuts at ${c.cuts.slice(0, 6).join(", ")}s` : ""} · highlights ${c.highlights.map((h) => `${h.start}–${h.end}s`).join(", ")}` +
        qualityNote(c) +
        (c.hdr ? " · HDR (tonemapped)" : "") +
        (c.sampled ? ` · long recording (${Math.round(c.sampled.sourceDuration / 60)} min), sampled as ${c.sampled.segments.length} segments from ${c.sampled.segments.map((g) => fmtMin(g.sourceStart)).join(", ")}` : ""),
    ),
    a.photos.length ? `\nPHOTOS: ${a.photos.map((p) => `${p.id} (${p.folder ? p.folder + "/" : ""}${p.name}, ${p.width > p.height ? "landscape" : "portrait"})`).join(", ")}` : "",
    a.audio.length ? `\nAUDIO: ${a.audio.map((t) => `${t.id} "${t.name}" ${t.duration}s${t.bpm ? `, ${t.bpm} BPM` : ""}`).join(", ")} (used as the soundtrack unless a theme says otherwise; cuts follow its detected beat)` : "",
    "",
    "STYLES you can build themes on:",
    styleCatalog(),
    "",
    occasionBrief(a.occasion),
  ].join("\n");
}

/** How to write themes; the same rules propose_themes enforces. */
export const THEME_RULES = [
  "Work out what each clip shows (people, stage, crowd, venue, mood, time of day). Then give:",
  "- clip_notes: one short line per clip/photo saying what's in it (shown to the user in the website's media bin);",
  "- 3–4 themes that tell DIFFERENT stories with this footage: each names real moments in its pitch, has a one-line story arc, and a curated shot list (3+ shots: the opener, the peak, the closer, with start times read off the sheet timestamps and captions where they help). The planner fills the gaps between your shots on the music's beat.",
  "- Use at least three different styles; no two themes may open and close on the same shots.",
].join("\n");

/** Contact sheets in the order Claude should see them, each with its caption. */
export function contactSheets(a: Analysis, dir: string, max = Infinity): { label: string; file: string }[] {
  const out = a.clips.slice(0, max).map((c) => ({ label: `${c.id} (${c.name}) — frames at ${c.sheetTimes.join("s, ")}s`, file: path.join(dir, c.sheet) }));
  if (a.photoSheet) out.push({ label: `Photos, left→right, top→bottom: ${a.photos.slice(0, 16).map((p) => p.id).join(", ")}`, file: path.join(dir, a.photoSheet) });
  return out.filter((s) => fs.existsSync(s.file));
}

/** Why a set of themes can't be used, or null when it's fine. */
export function themeProblems(a: Analysis, themes: ThemeInput[]): string | null {
  const ids = new Set([...a.clips.map((c) => c.id), ...a.photos.map((p) => p.id)]);
  const unknown = themes.flatMap((t, i) => t.shots.filter((s) => !ids.has(s.id)).map((s) => `theme ${i + 1}: unknown shot id ${s.id}`));
  if (unknown.length) return `Fix these: ${unknown.join("; ")}`;
  if (new Set(themes.map((t) => t.styleId)).size < Math.min(3, themes.length)) return "Use at least three different styleIds so the options feel distinct.";
  const arcs = themes.map((t) => t.shots.map((s) => s.id).join(","));
  if (new Set(arcs).size < themes.length || new Set(themes.map((t) => t.shots[0].id + "|" + t.shots[t.shots.length - 1].id)).size < themes.length) {
    return "Two themes open and close on the same shots. Give each theme its own story: a different opener or closer, and a different order of moments.";
  }
  const profile = occasionProfile(a.occasion);
  const clashing = themes.filter((t) => profile.avoid.includes(t.styleId));
  if (clashing.length > 1 || !themes.some((t) => profile.styles.includes(t.styleId))) {
    return `These styles don't suit ${profile.label}. Build most themes on ${profile.styles.join(", ")}${profile.avoid.length ? ` and avoid ${profile.avoid.join(", ")}` : ""}.`;
  }
  return null;
}

/** Saves what Claude saw in each clip; the website's media bin shows these as labels. */
export function applyClipNotes(a: Analysis, dir: string, notes: Record<string, string> | undefined) {
  if (!notes) return;
  for (const c of a.clips) if (notes[c.id]) c.notes = notes[c.id].slice(0, 160);
  for (const p of a.photos) if (notes[p.id]) p.notes = notes[p.id].slice(0, 160);
  fs.writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(a, null, 2));
}

/**
 * One still per theme (its title card over its footage, in its style) so the user can choose by eye.
 * Stops starting new stills once `budgetMs` has passed.
 */
export async function renderThemePreviews(a: Analysis, dir: string, themes: Theme[], budgetMs: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const startedAt = Date.now();
  for (const t of themes) {
    if (Date.now() - startedAt > budgetMs) break;
    const still = path.join(dir, "previews", `${t.id}.jpg`);
    try {
      fs.mkdirSync(path.dirname(still), { recursive: true });
      const { plan } = buildPlan(a, t);
      await renderPreviewStill({ plan: { ...plan, music: null }, assetDir: dir, outFile: still });
      out[t.id] = still;
    } catch (e) {
      console.error(`preview for ${t.id} failed:`, e);
    }
  }
  return out;
}
