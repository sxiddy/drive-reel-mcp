import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { STYLES, STYLE_IDS, type StyleId } from "../shared/styles";
import { occasionProfile } from "../shared/occasions";
import type { Analysis } from "./analyze";
import { analysisSummary, contactSheets, THEME_RULES, themeProblems } from "./brief";
import { bestWindow, CLEAN_MIN, detailRefOf, establishingScore, faceAt, groupScore, photoDetailRef, photoQuality, PHOTO_MIN, STAMPED, ThemeInput } from "./planner";

/**
 * The website's own theme writer: the same brief Claude gets in chat (stats, contact sheets,
 * occasion), sent through the Claude API so a visitor never has to open Claude to get themes.
 */

const MODEL = "claude-opus-5-5";

const Proposal = z.object({
  clip_notes: z.array(z.object({ id: z.string(), note: z.string() })).describe("One short line per clip/photo id saying what is in it"),
  themes: z.array(ThemeInput).describe("3 or 4 themes"),
});
type Proposal = { clipNotes: Record<string, string>; themes: ThemeInput[]; by: "claude" | "auto" };

export const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const SYSTEM = [
  "You are the editor behind Drive Reel, a website that turns a Google Drive folder of event footage into a finished, edited video for someone with no time to edit.",
  "You are shown every clip's measurements and contact sheets. Propose 3–4 themes the visitor can pick from with one click; the chosen one is rendered automatically.",
  "Make the options genuinely different in story, mood and pacing, grounded in what is actually in the footage. Title, subtitle and outro text appear on screen as written: use real names, dates and places from the folder or the occasion, never placeholders.",
].join(" ");

/** Asks Claude for themes; retries once with the reason when they break the rules. */
export async function proposeWithClaude(a: Analysis, dir: string): Promise<Proposal> {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: analysisSummary(a) }];
  for (const s of contactSheets(a, dir, 30)) {
    content.push({ type: "text", text: s.label });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(s.file).toString("base64") } });
  }
  content.push({ type: "text", text: `Each contact sheet is 8 frames across the clip, left→right, top→bottom, at the listed times.\n${THEME_RULES}` });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: betaZodOutputFormat(Proposal) },
        system: SYSTEM,
        messages,
      })
      .finalMessage();
    if (response.stop_reason === "refusal") throw new Error("Claude declined to write themes for this folder");
    if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
    const raw = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let problem: string | null;
    let parsed: z.infer<typeof Proposal> | null = null;
    try {
      parsed = Proposal.parse(JSON.parse(raw));
      problem =
        parsed.themes.length < 3 || parsed.themes.length > 4 ? "Give 3 or 4 themes." : themeProblems(a, parsed.themes);
    } catch (e) {
      problem = `The answer didn't match the schema: ${(e as Error).message.slice(0, 600)}`;
    }
    if (parsed && !problem) {
      return { clipNotes: Object.fromEntries(parsed.clip_notes.map((n) => [n.id, n.note])), themes: parsed.themes, by: "claude" };
    }
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: `${problem} Send the full corrected answer.` });
  }
  throw new Error("Claude's themes broke the rules twice");
}

/**
 * Themes without Claude: the occasion's best styles over three different arcs through the
 * strongest material. Plainer than Claude's, but every option still opens, peaks and closes on
 * real footage. Moments are scored exactly as the planner scores them (quality, folder-relative
 * sharpness, stamped files), so a blurred swing, a ceiling or a map-stamped clip is never an anchor.
 */
export function autoThemes(a: Analysis): Proposal {
  const profile = occasionProfile(a.occasion);
  const styles: StyleId[] = [...new Set([...profile.styles, ...STYLE_IDS.filter((s) => !profile.avoid.includes(s))])].slice(0, 3);
  if (!a.clips.length && !a.photos.length) throw new Error("The folder has no usable clips or photos");
  const detailRef = detailRefOf(a.clips);
  const photoRef = photoDetailRef(a.photos, detailRef);
  /** establish: wide sharp venue shot; group: how many faces (a group photo). */
  type Item = { id: string; label: string; start?: number; calm: number; peak: number; clean: boolean; establish: number; group: number; long: boolean };
  const title = a.occasion.length <= 60 ? a.occasion : a.occasion.slice(0, 57) + "…";

  const themes = styles.map((styleId, k): ThemeInput => {
    const style = STYLES[styleId];
    const len = style.shotLength + style.transition.duration;
    const items: Item[] = [
      ...a.clips.map((c): Item => {
        const calm = bestWindow(c, len, { ...style, prefer: "calm" }, detailRef);
        const peak = bestWindow(c, len, { ...style, prefer: "energy" }, detailRef);
        const clean = !STAMPED.test(c.name) && (calm?.clean ?? 0) >= CLEAN_MIN && (peak?.clean ?? 0) >= CLEAN_MIN;
        const at = (style.prefer === "calm" ? calm : peak)?.start;
        const face = at !== undefined ? faceAt(c, at + len / 2) : undefined;
        const ds = (c.detail ?? []).filter((x) => Number.isFinite(x));
        const detail = ds.length ? ds.reduce((x, y) => x + y, 0) / ds.length : detailRef;
        const establish = establishingScore({ detail, detailRef, faces: face, landscape: c.orientation === "landscape", clean: calm?.clean ?? 0 });
        return { id: c.id, label: c.name, start: at, calm: calm?.score ?? 0, peak: peak?.score ?? 0, clean, establish, group: groupScore(face, calm?.clean ?? 0) * 0.8, long: c.duration >= 4 };
      }),
      ...a.photos.map((p): Item => {
        const q = photoQuality(p, photoRef);
        const establish = establishingScore({ detail: p.detail ?? photoRef, detailRef: photoRef, faces: p.faces, landscape: p.width > p.height, clean: q }) * 0.8;
        return { id: p.id, label: p.name, calm: 0.5 * q, peak: 0.2 * q, clean: q >= PHOTO_MIN && !STAMPED.test(p.name), establish, group: groupScore(p.faces, q), long: true };
      }),
    ];
    // Only clean material anchors a theme, unless the folder has nothing clean at all.
    const pool = items.some((i) => i.clean) ? items.filter((i) => i.clean) : items;
    const byCalm = [...pool].sort((x, y) => y.calm - x.calm);
    const byPeak = [...pool].sort((x, y) => y.peak - x.peak);
    const pick = (list: Item[], skip: string[]) => list.find((i) => !skip.includes(i.id)) ?? list[0];
    // Story shape: open on the venue (widest sharp establishing shot), peak on the strongest crowd moment,
    // close on the biggest group shot. Each theme takes the k-th best opener so the arcs still differ.
    // The strongest moment is kept for the peak, never spent on the opening.
    const top = byPeak[0];
    const byEstablish = [...pool].filter((i) => i.long && (pool.length < 2 || i.id !== top.id)).sort((x, y) => y.establish - x.establish);
    const opener = byEstablish[k % Math.max(1, Math.min(3, byEstablish.length))] ?? byCalm[k % byCalm.length];
    const peak = pick(byPeak, [opener.id]);
    const byGroup = [...pool].sort((x, y) => y.group - x.group);
    const closer = (byGroup[0]?.group ?? 0) > 0 ? pick(byGroup, [opener.id, peak.id]) : pick([...byCalm.slice((k + 1) % byCalm.length), ...byCalm], [opener.id, peak.id]);
    const shot = (i: Item) => ({ id: i.id, ...(i.start !== undefined ? { start: i.start } : {}) });
    return {
      name: `${style.name} cut`,
      pitch: `${style.feel} Opens on ${opener.label}, builds to ${peak.label} and closes on ${closer.label}.`.slice(0, 300),
      story: `Opens calm on ${opener.label}, peaks on ${peak.label}, ends on ${closer.label}.`.slice(0, 200),
      occasionFit: `${profile.tone}`.slice(0, 200).padEnd(10, "."),
      styleId,
      title,
      outroText: profile.id === "memorial" ? "Forever remembered" : "Until next time",
      shots: [shot(opener), shot(peak), shot(closer)],
    };
  });
  return { clipNotes: {}, themes, by: "auto" };
}
