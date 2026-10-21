import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { STYLES, STYLE_IDS, type StyleId } from "../shared/styles";
import { occasionProfile } from "../shared/occasions";
import type { Analysis } from "./analyze";
import { analysisSummary, contactSheets, THEME_RULES, themeProblems } from "./brief";
import { ThemeInput } from "./planner";

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

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Themes without Claude: the occasion's best styles over three different arcs through the
 * strongest material. Plainer than Claude's, but every option still opens, peaks and closes on
 * real footage.
 */
export function autoThemes(a: Analysis): Proposal {
  const profile = occasionProfile(a.occasion);
  const styles: StyleId[] = [...new Set([...profile.styles, ...STYLE_IDS.filter((s) => !profile.avoid.includes(s))])].slice(0, 3);
  type Item = { id: string; label: string; start?: number; calm: number; peak: number };
  const items: Item[] = [
    ...a.clips.map((c) => {
      const q = c.quality?.length ? mean(c.quality) : 1;
      const best = c.highlights[0];
      return { id: c.id, label: c.name, start: best?.start, calm: q * (1 - mean(c.motion)), peak: q * (mean(c.energy) + mean(c.motion)) };
    }),
    ...a.photos.map((p) => ({ id: p.id, label: p.name, calm: 0.5, peak: 0.2 })),
  ];
  if (!items.length) throw new Error("The folder has no usable clips or photos");
  const byCalm = [...items].sort((x, y) => y.calm - x.calm);
  const byPeak = [...items].sort((x, y) => y.peak - x.peak);
  const pick = (list: Item[], skip: string[]) => list.find((i) => !skip.includes(i.id)) ?? list[0];
  const title = a.occasion.length <= 60 ? a.occasion : a.occasion.slice(0, 57) + "…";

  const themes = styles.map((styleId, k): ThemeInput => {
    const style = STYLES[styleId];
    // Each theme rotates which strong shot opens and which closes, so the three arcs differ.
    const opener = byCalm[k % byCalm.length];
    const peak = pick(byPeak, [opener.id]);
    const closer = pick([...byCalm.slice((k + 1) % byCalm.length), ...byCalm], [opener.id, peak.id]);
    const shot = (i: Item) => ({ id: i.id, ...(i.start !== undefined ? { start: i.start } : {}) });
    return {
      name: `${style.name} cut`,
      pitch: `${style.feel} Opens on ${opener.label}, builds to ${peak.label} and closes on ${closer.label}.`.slice(0, 300),
      story: `Opens calm on ${opener.label}, peaks on ${peak.label}, ends on ${closer.label}.`.slice(0, 200),
      occasionFit: `${profile.tone}`.slice(0, 200).padEnd(10, "."),
      styleId,
      title,
      outroText: profile.id === "memorial" ? "Forever remembered" : "Thanks for watching",
      shots: [shot(opener), shot(peak), shot(closer)],
    };
  });
  return { clipNotes: {}, themes, by: "auto" };
}
