/**
 * Visual + audio check of the render layer: npx tsx tests/render-check.ts [stills|full] [outDir]
 *
 * stills: renders key frames of a motion-graphics plan (every card layout) at 16:9, 9:16 and 1:1, in several
 *         styles, plus frames of a footage plan, and tiles them into contact sheets to look at.
 * full:   renders the motion-graphics and footage plans to MP4 at the same time (concurrency check), measures
 *         loudness with ebur128, checks that consecutive frames differ, and writes 1 fps frame grids.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EditPlan, planDurationInFrames, timelineSegments, transitionFrames, type Scene } from "../shared/plan";
import { STYLES, type StyleId } from "../shared/styles";
import { measureLoudness } from "../render/loudness";
import { renderPlan, renderPlanStill, renderPreviewStill } from "../render/render";

const require = createRequire(import.meta.url);
const FFMPEG: string = require("ffmpeg-static");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "stills";
const OUT = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), "drive-reel-render-check"));
fs.mkdirSync(OUT, { recursive: true });

function ffmpeg(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-y", ...args], { windowsHide: true });
    const out: Buffer[] = [];
    let stderr = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr }) : reject(new Error(stderr.slice(-1500)))));
  });
}

// ─── motion-graphics plan (StudyHub) ────────────────────────────────────────

const mgAssets = path.join(OUT, "mg-assets");
fs.mkdirSync(path.join(mgAssets, "assets"), { recursive: true });

async function makeScreenshot(file: string) {
  // A placeholder "app screenshot": sidebar, header, cards.
  const boxes = [
    "drawbox=x=0:y=0:w=300:h=1000:color=0x111827:t=fill",
    "drawbox=x=40:y=50:w=200:h=36:color=0x38bdf8:t=fill",
    "drawbox=x=40:y=140:w=180:h=22:color=0x374151:t=fill",
    "drawbox=x=40:y=190:w=150:h=22:color=0x374151:t=fill",
    "drawbox=x=40:y=240:w=170:h=22:color=0x374151:t=fill",
    "drawbox=x=360:y=50:w=700:h=48:color=0xe5e7eb:t=fill",
    "drawbox=x=1300:y=46:w=240:h=56:color=0x38bdf8:t=fill",
    "drawbox=x=360:y=160:w=380:h=300:color=0xffffff:t=fill",
    "drawbox=x=780:y=160:w=380:h=300:color=0xffffff:t=fill",
    "drawbox=x=1200:y=160:w=360:h=300:color=0xffffff:t=fill",
    "drawbox=x=380:y=180:w=340:h=150:color=0xbae6fd:t=fill",
    "drawbox=x=800:y=180:w=340:h=150:color=0xc7d2fe:t=fill",
    "drawbox=x=1220:y=180:w=320:h=150:color=0xfde68a:t=fill",
    "drawbox=x=380:y=350:w=260:h=20:color=0x9ca3af:t=fill",
    "drawbox=x=800:y=350:w=220:h=20:color=0x9ca3af:t=fill",
    "drawbox=x=1220:y=350:w=240:h=20:color=0x9ca3af:t=fill",
    "drawbox=x=360:y=500:w=1200:h=440:color=0xffffff:t=fill",
    "drawbox=x=390:y=540:w=500:h=26:color=0x1f2937:t=fill",
    "drawbox=x=390:y=600:w=1100:h=18:color=0xd1d5db:t=fill",
    "drawbox=x=390:y=640:w=1000:h=18:color=0xd1d5db:t=fill",
    "drawbox=x=390:y=680:w=1060:h=18:color=0xd1d5db:t=fill",
    "drawbox=x=390:y=740:w=420:h=160:color=0xe0f2fe:t=fill",
  ].join(",");
  await ffmpeg(["-f", "lavfi", "-i", "color=c=0xf3f4f6:s=1600x1000", "-vf", boxes, "-frames:v", "1", file]);
}

function mgPlan(styleId: StyleId, aspect: EditPlan["aspect"]): EditPlan {
  const scenes: Scene[] = [
    { id: "c1", kind: "card", duration: 4, kicker: "The problem", heading: "Notes everywhere, nothing in one place", body: "Group chats, drives and screenshots: finding the right material takes longer than studying it." },
    { id: "c2", kind: "card", duration: 4.5, kicker: "Meet StudyHub", heading: "One hub for every course", bullets: ["Shared lecture notes", "Past papers, solved", "Deadlines that remind you"] },
    { id: "c3", kind: "card", duration: 4.5, kicker: "The product", heading: "Your whole semester, one tab", body: "Notes, papers and deadlines, organised by course.", image: "assets/screenshot.png", device: "laptop" },
    { id: "c4", kind: "card", duration: 4, kicker: "Search", heading: "Find any topic in seconds", body: "Full-text search across every note your class has shared.", icon: "search" },
    { id: "c5", kind: "card", duration: 4, kicker: "Traction", heading: "Shared this semester", stat: { value: 12480, suffix: "+", label: "notes from 40 colleges" } },
    { id: "c6", kind: "card", duration: 4, heading: "“I stopped hunting for notes the night before exams.”", body: "Priya, 2nd-year CS" },
    { id: "c7", kind: "card", duration: 4, layout: "feature", kicker: "Built for focus", heading: "Study sessions with friends", body: "Live rooms, shared timers and flashcards.", icon: "users" },
    { id: "c8", kind: "card", duration: 3.5, layout: "statement", kicker: "Free for students", heading: "Study smarter, together." },
  ];
  return EditPlan.parse({
    version: 1,
    title: "StudyHub",
    subtitle: "Everything you need to ace the semester",
    occasion: "Product launch",
    themeName: "Launch film",
    styleId,
    aspect,
    fps: 30,
    palette: STYLES[styleId].palette,
    assetBase: "",
    music: { src: "assets/music.wav", volume: 0.7, bpm: STYLES[styleId].music.bpm, credit: "Generated", duration: 22 },
    intro: { duration: 3 },
    outro: { text: "Start studying smarter", duration: 3 },
    transition: STYLES[styleId].transition,
    scenes,
  });
}

// ─── footage plan (VinHack, published plan + sample clips) ──────────────────

const footageDir = path.join(ROOT, "data", "videos", "b29cdb4130");
function footagePlan(): EditPlan {
  const plan = JSON.parse(fs.readFileSync(path.join(footageDir, "plan.json"), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "projects", "prj-49bead", "analysis.json"), "utf8"));
  const dims = new Map<string, { width: number; height: number }>();
  for (const c of analysis.clips) dims.set(`assets/${c.id}.mp4`, c);
  for (const s of plan.scenes) {
    const d = dims.get(s.src);
    if (s.kind === "video" && d) Object.assign(s, { srcWidth: d.width, srcHeight: d.height });
  }
  plan.music.duration = 22;
  return EditPlan.parse(plan);
}

/** Start frame of each timeline segment (intro, scenes, outro). */
function segmentStarts(plan: EditPlan) {
  const segs = timelineSegments(plan);
  const starts: Record<string, { start: number; frames: number }> = {};
  let at = 0;
  segs.forEach((s, i) => {
    if (i > 0) at += segs[i - 1].frames - transitionFrames(plan, segs[i - 1].frames, s.frames);
    starts[s.key] = { start: at, frames: s.frames };
  });
  return starts;
}

async function tile(files: string[], out: string, cols: number, w: number) {
  const list = path.join(OUT, `${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  const rows = Math.ceil(files.length / cols);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${w}:-2,tile=${cols}x${rows}:padding=6:color=0x222222`, "-frames:v", "1", "-q:v", "3", out]);
  return out;
}

async function stills() {
  await makeScreenshot(path.join(mgAssets, "assets", "screenshot.png"));
  fs.copyFileSync(path.join(ROOT, "work", "projects", "prj-77fb32", "assets", "music.wav"), path.join(mgAssets, "assets", "music.wav"));
  const which = (process.env.ONLY ?? "clean:16:9,clean:9:16,clean:1:1").split(",");
  for (const spec of which) {
    const [style, ...a] = spec.split(":");
    const aspect = a.join(":") as EditPlan["aspect"];
    const plan = mgPlan(style as StyleId, aspect);
    const st = segmentStarts(plan);
    const frames: string[] = [];
    // Intro, then each card at ~20%, ~75% of its run, then the outro.
    const picks: number[] = [st.intro.start + 50];
    for (const s of plan.scenes) picks.push(st[s.id].start + Math.round(st[s.id].frames * 0.22), st[s.id].start + Math.round(st[s.id].frames * 0.72));
    picks.push(st.outro.start + 60);
    const tag = `${style}-${aspect.replace(":", "x")}`;
    for (const [i, f] of picks.entries()) {
      const file = path.join(OUT, "stills", tag, `${String(i).padStart(2, "0")}-f${f}.jpg`);
      await renderPlanStill({ plan, assetDir: mgAssets, frame: f, output: file, scale: aspect === "16:9" ? 0.5 : 0.5 });
      frames.push(file);
    }
    const sheet = await tile(frames, path.join(OUT, `sheet-${tag}.jpg`), aspect === "9:16" ? 6 : 4, aspect === "9:16" ? 320 : 480);
    console.log("sheet", sheet);
  }
  if (process.env.FOOTAGE !== "0") {
    const plan = footagePlan();
    const st = segmentStarts(plan);
    const picks = [st.intro.start + 40, st.s1.start + 30, st.s2.start + 40, st.s3.start + 40, st.s4.start + 40, st.outro.start + 50];
    const frames: string[] = [];
    for (const [i, f] of picks.entries()) {
      const file = path.join(OUT, "stills", "footage", `${i}-f${f}.jpg`);
      await renderPlanStill({ plan, assetDir: footageDir, frame: f, output: file, scale: 0.5 });
      frames.push(file);
    }
    console.log("sheet", await tile(frames, path.join(OUT, "sheet-footage.jpg"), 3, 640));
    const preview = path.join(OUT, "preview-still.jpg");
    await renderPreviewStill({ plan, assetDir: footageDir, outFile: preview });
    console.log("preview", preview);
  }
}

/** Mean absolute difference between consecutive frames at a few points (0 = identical). */
async function frameDiffs(file: string, plan: EditPlan) {
  const st = segmentStarts(plan);
  const results: { at: string; diff: number }[] = [];
  for (const s of plan.scenes) {
    for (const k of [0.5, 0.85]) {
      const n = st[s.id].start + Math.round(st[s.id].frames * k);
      const { stdout } = await ffmpeg(["-i", file, "-vf", `select='between(n\\,${n}\\,${n + 1})',scale=320:-2,format=gray`, "-vsync", "0", "-f", "rawvideo", "-"]);
      const half = stdout.length / 2;
      let sum = 0;
      for (let i = 0; i < half; i++) sum += Math.abs(stdout[i] - stdout[half + i]);
      results.push({ at: `${s.id}@${n}`, diff: Number((sum / half).toFixed(3)) });
    }
  }
  return results;
}

async function full() {
  await makeScreenshot(path.join(mgAssets, "assets", "screenshot.png"));
  fs.copyFileSync(path.join(ROOT, "work", "projects", "prj-77fb32", "assets", "music.wav"), path.join(mgAssets, "assets", "music.wav"));
  const mg = mgPlan((process.env.STYLE as StyleId) ?? "clean", (process.env.ASPECT as EditPlan["aspect"]) ?? "16:9");
  const footage = footagePlan();
  const mgOut = path.join(OUT, "mg.mp4");
  const ftOut = path.join(OUT, "footage.mp4");
  const t0 = Date.now();
  // Both at once: this used to fail with "port not available".
  const results = await Promise.allSettled([
    renderPlan({ plan: mg, assetDir: mgAssets, outFile: mgOut, posterFile: path.join(OUT, "mg.jpg") }),
    renderPlan({ plan: footage, assetDir: footageDir, outFile: ftOut, posterFile: path.join(OUT, "footage.jpg") }),
  ]);
  console.log(`concurrent renders: ${results.map((r) => r.status).join(", ")} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const r of results) if (r.status === "rejected") console.error(r.reason);
  if (results.some((r) => r.status === "rejected")) process.exit(1);

  for (const [name, file, plan] of [["motion", mgOut, mg], ["footage", ftOut, footage]] as const) {
    const l = await measureLoudness(file);
    console.log(`${name}: ${planDurationInFrames(plan) / 30}s, integrated ${l.lufs} LUFS, true peak ${l.truePeak} dBFS`);
    const grid = path.join(OUT, `grid-${name}.jpg`);
    const secs = Math.ceil(planDurationInFrames(plan) / 30);
    const cols = 6;
    await ffmpeg(["-i", file, "-vf", `fps=1,scale=400:-2,tile=${cols}x${Math.ceil(secs / cols)}:padding=4:color=0x222222`, "-frames:v", "1", "-q:v", "3", grid]);
    console.log(`  grid ${grid}`);
  }
  const diffs = await frameDiffs(mgOut, mg);
  console.log("consecutive-frame differences (motion):", diffs.map((d) => `${d.at}=${d.diff}`).join(" "));
  console.log(`identical pairs: ${diffs.filter((d) => d.diff === 0).length} of ${diffs.length}`);
}

await (mode === "full" ? full() : stills());
