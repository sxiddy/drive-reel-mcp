import fs from "node:fs";
import path from "node:path";
import { EditPlan, planDurationInFrames, type CardScene } from "../shared/plan";
import type { MediaManifest } from "../shared/media";
import { STYLES, type StyleId } from "../shared/styles";
import { musicFor } from "../shared/occasions";
import { renderPlan } from "../render/render";
import { synthesizeTrack, writeWav } from "./music";
import { buildPlan, type Theme } from "./planner";
import { loadAnalysis, loadProject, projectDir, saveProject } from "./projects";
import { buildManifest, publishVideo, type Published } from "./publish";

export type GenerateResult = {
  projectId: string;
  themeId: string;
  themeName: string;
  durationSeconds: number;
  scenes: number;
  localFile: string;
  published?: Published;
  publishError?: string;
  notes: string[];
};

async function renderAndPublish(opts: {
  projectId: string;
  themeId: string;
  plan: EditPlan;
  manifest: MediaManifest;
  pitch?: string;
  story?: string;
  occasionFit?: string;
  source?: string;
  notes: string[];
  update: (stage: string, p: number) => void;
}): Promise<GenerateResult> {
  const dir = projectDir(opts.projectId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(dir, "out", `${opts.themeId}-${stamp}.mp4`);
  const posterFile = outFile.replace(/\.mp4$/, ".jpg");
  fs.writeFileSync(path.join(dir, `plan-${opts.themeId}.json`), JSON.stringify(opts.plan, null, 2));

  opts.update("Rendering video", 0.1);
  await renderPlan({ plan: opts.plan, assetDir: dir, outFile, posterFile, onProgress: (p) => opts.update(`Rendering video ${Math.round(p * 100)}%`, 0.1 + p * 0.8) });

  opts.update("Publishing to the website", 0.92);
  let published: Published | undefined;
  let publishError: string | undefined;
  try {
    published = await publishVideo({
      plan: opts.plan,
      meta: { title: opts.plan.title, themeName: opts.plan.themeName, pitch: opts.pitch, story: opts.story, occasionFit: opts.occasionFit, occasion: opts.plan.occasion, source: opts.source },
      videoFile: outFile,
      posterFile,
      assetDir: dir,
      manifest: opts.manifest,
    });
  } catch (e) {
    publishError = (e as Error).message;
  }

  const project = loadProject(opts.projectId);
  project.videos.push({ themeId: opts.themeId, url: published?.url, editUrl: published?.editUrl, file: outFile, createdAt: new Date().toISOString() });
  saveProject(project);

  return {
    projectId: opts.projectId,
    themeId: opts.themeId,
    themeName: opts.plan.themeName,
    durationSeconds: Math.round((planDurationInFrames(opts.plan) / opts.plan.fps) * 10) / 10,
    scenes: opts.plan.scenes.length,
    localFile: outFile,
    published,
    publishError,
    notes: opts.notes,
  };
}

/** Drive route: analysis + chosen theme → plan → soundtrack → render → publish. */
export async function generateFromTheme(projectId: string, theme: Theme, durationOverride: number | undefined, update: (s: string, p: number) => void) {
  update("Planning the edit", 0.02);
  const analysis = loadAnalysis(projectId);
  const { plan, musicNeeded, notes } = buildPlan(analysis, theme, { durationOverride });
  const dir = projectDir(projectId);
  if (musicNeeded?.kind === "generated") {
    update("Composing the soundtrack", 0.05);
    const rel = `assets/music-${theme.id}.wav`;
    writeWav(path.join(dir, rel), synthesizeTrack(musicFor(STYLES[theme.styleId], analysis.occasion), musicNeeded.seconds, theme.id.charCodeAt(1)));
    plan.music = { ...plan.music!, src: rel };
  }
  const project = loadProject(projectId);
  return renderAndPublish({
    projectId,
    themeId: theme.id,
    plan,
    manifest: buildManifest(plan, analysis),
    pitch: theme.pitch,
    story: theme.story,
    occasionFit: theme.occasionFit,
    source: project.source,
    notes,
    update,
  });
}

export type MotionScene = Omit<CardScene, "id" | "kind" | "duration" | "image"> & {
  /** http(s) URL of a product screenshot; downloaded into the project. */
  image_url?: string;
};

export type MotionInput = {
  title: string;
  subtitle?: string;
  occasion: string;
  styleId: StyleId;
  aspect: EditPlan["aspect"];
  durationSeconds: number;
  outroText: string;
  accentColor?: string;
  sourceUrl?: string;
  scenes: MotionScene[];
};

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Fetches a screenshot Claude found on the product's site. Images only, at most 15 MB. */
async function downloadImage(url: string, destNoExt: string): Promise<string> {
  const host = new URL(url).hostname;
  if (!/^https?:\/\//i.test(url)) throw new Error("not an http(s) URL");
  // Only public sites: a URL from a web page must not make this machine fetch its own network.
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("private address");
  }
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "error" });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!res.ok || !IMAGE_TYPES[type]) throw new Error(`${res.status} ${type || "unknown type"}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 15e6) throw new Error("larger than 15 MB");
  const file = `${destNoExt}.${IMAGE_TYPES[type]}`;
  fs.writeFileSync(file, buf);
  return file;
}

/** Fallback route: no footage, the whole video is motion-graphics scenes written by Claude. */
export async function generateMotionGraphics(projectId: string, input: MotionInput, update: (s: string, p: number) => void) {
  const style = STYLES[input.styleId];
  const music = musicFor(style, input.occasion);
  const dir = projectDir(projectId);
  const notes: string[] = [];
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  update("Fetching screenshots", 0.02);
  const images: (string | undefined)[] = [];
  for (const [i, s] of input.scenes.entries()) {
    if (!s.image_url) {
      images.push(undefined);
      continue;
    }
    try {
      const file = await downloadImage(s.image_url, path.join(dir, "assets", `shot-${i + 1}`));
      images.push(path.relative(dir, file).split(path.sep).join("/"));
    } catch (e) {
      images.push(undefined);
      notes.push(`Couldn't use the screenshot for scene ${i + 1} (${(e as Error).message}); it was made without one.`);
    }
  }

  const intro = Math.min(3.5, input.durationSeconds * 0.12);
  const outro = Math.min(3, input.durationSeconds * 0.1);
  const td = Math.min(style.transition.duration, 0.6);
  const n = input.scenes.length;
  // Σscenes = target − intro − outro + (n + 1)·td; give scenes with more to read or watch more time.
  const weights = input.scenes.map(
    (s, i) => 1 + (s.body?.length ?? 0) / 120 + (s.bullets?.length ?? 0) * 0.3 + (s.stat ? 0.3 : 0) + (images[i] ? 0.5 : 0),
  );
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pool = input.durationSeconds - intro - outro + (n + 1) * td;
  const scenes: CardScene[] = input.scenes.map(({ image_url: _url, ...s }, i) => {
    const image = images[i];
    // A screenshot scene whose image failed falls back to a layout that doesn't need one.
    const layout = s.layout === "screenshot" && !image ? (s.icon ? "feature" : "statement") : s.layout;
    return { ...s, layout, image, id: `c${i + 1}`, kind: "card", duration: Math.max(2, Math.round(((pool * weights[i]) / wsum) * 100) / 100) };
  });
  const musicSeconds = Math.ceil(input.durationSeconds + 20);
  const musicRel = "assets/music.wav";
  const plan = EditPlan.parse({
    version: 1,
    title: input.title,
    subtitle: input.subtitle,
    occasion: input.occasion,
    themeName: `${style.name} motion graphics`,
    styleId: input.styleId,
    aspect: input.aspect,
    fps: 30,
    palette: { ...style.palette, ...(input.accentColor ? { accent: input.accentColor } : {}) },
    assetBase: "",
    music: { src: musicRel, volume: 0.7, bpm: music.bpm, credit: "Generated soundtrack", duration: musicSeconds },
    intro: { duration: Math.round(intro * 100) / 100 },
    outro: { text: input.outroText, duration: Math.round(outro * 100) / 100 },
    transition: { type: style.transition.type, duration: td },
    scenes,
  });
  update("Composing the soundtrack", 0.05);
  writeWav(path.join(dir, musicRel), synthesizeTrack(music, musicSeconds));
  return renderAndPublish({ projectId, themeId: "motion", plan, manifest: buildManifest(plan, null), source: input.sourceUrl, notes, update });
}
