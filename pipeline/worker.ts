import fs from "node:fs";
import path from "node:path";
import { STYLES } from "../shared/styles";
import { readStatus, songPath, writeStatus, type MakeStatus, type MakeTheme } from "../shared/make";
import { analyzeSource, prepareSong } from "../mcp/analyze";
import { applyClipNotes, renderThemePreviews } from "../mcp/brief";
import { autoThemes, claudeAvailable, proposeWithClaude } from "../mcp/claude";
import { generateFromTheme } from "../mcp/generate";
import { buildPlan, type Theme } from "../mcp/planner";
import { ROOT, loadAnalysis, loadProject, projectDir, saveProject } from "../mcp/projects";

/**
 * Runs one website job in its own process (the site spawns it, like render/cli.ts):
 *   worker.ts analyze <projectId>          Drive folder → analysis → themes with preview stills
 *   worker.ts generate <projectId> <theme> chosen theme → rendered, published video
 * Progress goes to the project's status.json, which the website polls.
 */

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const localEnv = path.join(ROOT, ".env.local");
if (fs.existsSync(localEnv)) process.loadEnvFile(localEnv);

const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [cmd, projectId, themeId, variantArg] = args.filter((a) => a !== "--auto");
const dir = projectDir(projectId);
let status = readStatus(dir);
if (!status) throw new Error(`No status.json for ${projectId}`);

let lastWrite = 0;
function set(patch: Partial<MakeStatus>, force = true) {
  status = { ...status!, ...patch, pid: process.pid };
  if (!force && Date.now() - lastWrite < 600) return;
  lastWrite = Date.now();
  writeStatus(dir, status);
}

function themeCards(themes: Theme[], previews: Record<string, string>, analysis: ReturnType<typeof loadAnalysis>): MakeTheme[] {
  return themes.map((t) => {
    const { plan } = buildPlan(analysis, t);
    return {
      id: t.id,
      name: t.name,
      pitch: t.pitch,
      story: t.story,
      occasionFit: t.occasionFit,
      styleId: t.styleId,
      styleName: STYLES[t.styleId].name,
      title: t.title,
      aspect: plan.aspect,
      shots: plan.scenes.length,
      preview: Boolean(previews[t.id]),
    };
  });
}

async function analyze() {
  const project = loadProject(projectId);
  set({ step: "analyzing", stage: "Opening the Drive folder", progress: 0 });
  const analysis = await analyzeSource({
    projectId,
    projectDir: dir,
    source: project.source!,
    occasion: project.occasion,
    targetDuration: project.targetDuration,
    onProgress: (stage, p) => set({ stage, progress: p }, false),
  });
  // A song uploaded on the form joins the folder's audio, first, so it is the one used.
  const songId = status?.input.songId;
  const song = songId ? songPath(ROOT, songId) : null;
  if (song) {
    set({ stage: "Listening to your song", progress: 0.97 });
    analysis.audio.unshift(await prepareSong(song, dir, "a0", "Your song"));
    fs.writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));
  }
  const stats = { clips: analysis.clips.length, photos: analysis.photos.length, audio: analysis.audio.length, footageSeconds: Math.round(analysis.totals.footageSeconds) };
  if (!stats.clips && !stats.photos) throw new Error("No videos or photos could be read from this folder. Check it is shared as \"Anyone with the link\".");

  set({ step: "themes", stage: claudeAvailable() ? "Claude is watching the footage and writing themes" : "Writing themes", progress: 0.1, stats });
  let proposal;
  let themesNote: string | undefined;
  if (claudeAvailable()) {
    try {
      proposal = await proposeWithClaude(analysis, dir);
    } catch (e) {
      console.error("Claude themes failed:", e);
      themesNote = `Claude couldn't write themes (${(e as Error).message.slice(0, 120)}), so these come from the built-in rules.`;
    }
  } else {
    themesNote = "Built-in themes: add a Claude API key to the server for themes written from what's in your footage.";
  }
  proposal ??= autoThemes(analysis);
  applyClipNotes(analysis, dir, proposal.clipNotes);
  // The visitor's own event name and place beat anything guessed from the occasion.
  const { eventName, place } = status?.input ?? {};
  // Music: an uploaded song, else an audio file from the folder, else a royalty-free library track.
  if (status?.input.music === "own" && !analysis.audio.length) themesNote = [themesNote, "The song couldn't be used, so a royalty-free track is used."].filter(Boolean).join(" ");
  const musicChoice: Theme["music"] = analysis.audio.length ? "drive" : "library";
  const themes: Theme[] = proposal.themes.map((t, i) => ({
    ...t,
    music: musicChoice,
    id: `t${i + 1}`,
    ...(eventName ? { title: eventName } : {}),
    ...(place ? { subtitle: [place, t.subtitle].filter(Boolean).join(" · ").slice(0, 80) } : {}),
  }));
  project.themes = themes;
  saveProject(project);

  set({ stage: "Rendering a preview of each theme", progress: 0.7, themesBy: proposal.by, themesNote });
  const previews = await renderThemePreviews(analysis, dir, themes, 120_000);
  set({ step: "choose", stage: "Pick a theme", progress: 1, themes: themeCards(themes, previews, analysis) });
  // "Just make it": Claude lists its strongest theme first, so render that one now.
  if (auto) await generate(themes[0].id);
}

async function generate(id = themeId) {
  const project = loadProject(projectId);
  const theme = project.themes.find((t) => t.id === id);
  if (!theme) throw new Error(`No theme ${id}`);
  set({ step: "rendering", chosen: id, stage: Number(variantArg) ? "Planning another version" : "Planning the edit", progress: 0, error: undefined });
  const variant = Number(variantArg) || 0;
  const r = await generateFromTheme(projectId, theme, undefined, (stage, p) => set({ stage, progress: p }, false), variant, status?.input.matchSong === true);
  if (!r.published) throw new Error(r.publishError ?? "The video rendered but could not be published");
  set({ step: "done", stage: "Ready", progress: 1, result: { videoId: r.published.id, editKey: r.published.editKey, durationSeconds: r.durationSeconds } });
}

const work = cmd === "analyze" ? analyze : cmd === "generate" ? () => generate() : null;
if (!work) throw new Error(`Unknown command ${cmd}`);
work()
  .then(() => process.exit(0))
  .catch((e: Error) => {
    console.error(e);
    // A failed render leaves the themes in place so the visitor can pick again.
    const back = status?.step === "rendering" && status.themes?.length;
    set({ step: back ? "choose" : "error", error: e.message.slice(0, 400), stage: "Failed", progress: 0 });
    process.exit(1);
  });
