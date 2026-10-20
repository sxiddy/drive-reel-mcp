import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AspectRatio, CARD_ICONS } from "../shared/plan";
import { STYLES, STYLE_IDS } from "../shared/styles";
import { analyzeSource, type Analysis } from "./analyze";
import { generateFromTheme, generateMotionGraphics, type GenerateResult } from "./generate";
import { activeJobFor, getJob, startJob, waitForJob, type Job } from "./jobs";
import { buildPlan, ThemeInput, type Theme } from "./planner";
import { ROOT, createProject, loadAnalysis, loadProject, projectDir, saveProject } from "./projects";
import { siteUrl } from "./publish";
import { occasionProfile } from "../shared/occasions";
import { renderPreviewStill } from "../render/render";

// Stdout carries the MCP protocol; anything else must go to stderr.
console.log = console.error;
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string): Content => ({ type: "text", text: t });
const image = (file: string): Content => ({ type: "image", data: fs.readFileSync(file).toString("base64"), mimeType: "image/jpeg" });
const reply = (content: Content[], isError = false) => ({ content, isError });

/** How long a tool call blocks waiting on a job before handing back a job id to poll. */
const WAIT_MS = 50_000;
/** Contact sheets returned inline per call; the rest are available through view_clips. */
const SHEETS_PER_CALL = 12;

const styleCatalog = () =>
  STYLE_IDS.map((id) => {
    const s = STYLES[id];
    return `- ${id} ("${s.name}"): ${s.feel} Best for: ${s.bestFor}. ~${s.shotLength}s shots, ${s.music.bpm} BPM.`;
  }).join("\n");

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function occasionBrief(occasion: string) {
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

function describeAnalysis(a: Analysis): Content[] {
  const lines = [
    `Project ${a.projectId} is ready. Occasion: "${a.occasion}". Target length: ${a.targetDuration}s. Suggested frame: ${a.suggestedAspect}.`,
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
    "",
    "NEXT: Look at the contact sheets below (each is 8 frames across the clip, left→right, top→bottom; frame times are listed in its label).",
    "Work out what each clip shows (people, stage, crowd, venue, mood, time of day). Then call propose_themes with:",
    "- clip_notes: one short line per clip/photo saying what's in it (shown to the user in the website's media bin);",
    "- 3–4 themes that tell DIFFERENT stories with this footage: each names real moments in its pitch, has a one-line story arc, and a curated shot list (3+ shots: the opener, the peak, the closer, with start times read off the sheet timestamps and captions where they help). The planner fills the gaps between your shots on the music's beat.",
    "Use view_clips for any sheet not shown here.",
  ];
  const content: Content[] = [text(lines.filter((l) => l !== undefined).join("\n"))];
  const dir = projectDir(a.projectId);
  for (const c of a.clips.slice(0, SHEETS_PER_CALL)) {
    content.push(text(`${c.id} (${c.name}) — frames at ${c.sheetTimes.join("s, ")}s`));
    content.push(image(path.join(dir, c.sheet)));
  }
  if (a.photoSheet) {
    content.push(text(`Photos, left→right, top→bottom: ${a.photos.slice(0, 16).map((p) => p.id).join(", ")}`));
    content.push(image(path.join(dir, a.photoSheet)));
  }
  return content;
}

function describeGenerated(r: GenerateResult): Content[] {
  const lines = [
    `Rendered "${r.themeName}": ${r.durationSeconds}s, ${r.scenes} shots.`,
    r.published
      ? `Watch: ${r.published.url}\nEdit (change text, reorder/trim shots, swap style or music, re-render): ${r.published.editUrl}`
      : `Not published: ${r.publishError}\nThe video is saved locally at ${r.localFile}.`,
    ...r.notes.map((n) => `Note: ${n}`),
    "",
    "Share the watch link with the user and mention the editor link. Offer to try another theme or adjust (e.g. different title, length or shot order).",
  ];
  return [text(lines.join("\n"))];
}

function describeJob(job: Job | undefined): ReturnType<typeof reply> {
  if (!job) return reply([text("Unknown job id.")], true);
  if (job.status === "error") return reply([text(`Job ${job.id} failed: ${job.error}`)], true);
  if (job.status === "running") {
    const secs = Math.round((Date.now() - job.startedAt) / 1000);
    return reply([text(`Still working (${Math.round(job.progress * 100)}%, ${secs}s so far): ${job.stage}.\nCall check_job with job_id "${job.id}" again to keep waiting.`)]);
  }
  if (job.kind === "analyze") return reply(describeAnalysis(job.result as Analysis));
  return reply(describeGenerated(job.result as GenerateResult));
}

const server = new McpServer(
  { name: "drive-reel", version: "1.0.0" },
  {
    instructions: [
      "Drive Reel turns a Google Drive folder of event footage into a themed, edited video, published to a website where it can be watched and edited.",
      "Workflow:",
      "1. Make sure you have three inputs: the Drive folder link (shared as 'Anyone with the link'), the target duration, and the occasion. Ask for any that are missing.",
      "2. Call analyze_drive_folder. It downloads and watches the footage; if it returns a job id, call check_job until it finishes.",
      "3. Study the contact sheets and clip stats, then call propose_themes with 3–4 distinct themes. Present them to the user (name + pitch) and ask which one they want.",
      "4. Call generate_video with the chosen theme. It renders and publishes; poll check_job if needed. Give the user the watch and edit links.",
      "If the Drive route is not possible (no footage, or the user asks for a motion-graphics video, e.g. a StudyHub promo), ask the user for the product/website link, read it with your web tools, and call create_motion_graphics_video with scenes written from it.",
    ].join("\n"),
  },
);

server.registerTool(
  "analyze_drive_folder",
  {
    title: "Analyse a Google Drive folder",
    description:
      "Downloads the videos, photos and music in a Google Drive folder (shared as 'Anyone with the link'), then measures every clip (loudness, motion, internal cuts, best moments) and returns contact sheets you can look at. Large folders are sampled evenly across sub-folders. Takes about 10 seconds per clip; returns a job id to poll with check_job if it runs long.",
    inputSchema: {
      drive_link: z.string().describe("Google Drive folder or file link"),
      duration_seconds: z.number().min(8).max(300).describe("Target length of the final video in seconds"),
      occasion: z.string().min(2).max(80).describe("What the video is for, e.g. 'VinHack 2026 hackathon aftermovie', 'Riya's 21st birthday'"),
    },
  },
  async ({ drive_link, duration_seconds, occasion }) => {
    const project = createProject({ mode: "drive", source: drive_link, occasion, targetDuration: duration_seconds });
    const job = startJob("analyze", project.id, (update) =>
      analyzeSource({ projectId: project.id, projectDir: projectDir(project.id), source: drive_link, occasion, targetDuration: duration_seconds, onProgress: update }),
    );
    return describeJob(await waitForJob(job.id, WAIT_MS));
  },
);

server.registerTool(
  "check_job",
  {
    title: "Check a running job",
    description: "Waits up to ~50 seconds for an analysis or render job, then returns its result or current progress.",
    inputSchema: { job_id: z.string() },
  },
  async ({ job_id }) => describeJob(await waitForJob(job_id, WAIT_MS)),
);

server.registerTool(
  "view_clips",
  {
    title: "View clip contact sheets",
    description: "Returns the contact sheets for specific clips (8 frames each), for clips that weren't shown in the analysis result or that you want to look at again.",
    inputSchema: { project_id: z.string(), clip_ids: z.array(z.string()).min(1).max(12) },
  },
  async ({ project_id, clip_ids }) => {
    const a = loadAnalysis(project_id);
    const out: Content[] = [];
    for (const id of clip_ids) {
      const c = a.clips.find((x) => x.id === id);
      if (!c) {
        out.push(text(`${id}: no such clip`));
        continue;
      }
      out.push(text(`${c.id} (${c.name}, ${c.duration}s) — frames at ${c.sheetTimes.join("s, ")}s`));
      out.push(image(path.join(projectDir(project_id), c.sheet)));
    }
    return reply(out);
  },
);

server.registerTool(
  "propose_themes",
  {
    title: "Propose video themes",
    description:
      "Saves 3–4 theme options for the user to choose from and returns a preview frame of each. Each theme builds on a style preset and is tailored to this footage and occasion: its own name, a pitch that names real moments, a one-line story arc, title text, and a curated, ordered shot list (opener, peak, closer at least). Also pass clip_notes describing what each clip shows. Make the options genuinely different in story, mood and pacing. After calling this, show the user the options with their previews and ask them to pick.",
    inputSchema: {
      project_id: z.string(),
      clip_notes: z
        .record(z.string(), z.string().max(160))
        .optional()
        .describe("What you saw in each clip/photo, keyed by id, e.g. { v3: 'Team hugging on stage after the prize reveal' }"),
      themes: z.array(ThemeInput).min(3).max(4),
    },
  },
  async ({ project_id, clip_notes, themes }) => {
    const project = loadProject(project_id);
    const analysis = project.mode === "drive" ? loadAnalysis(project_id) : null;
    if (!analysis) return reply([text("propose_themes is for Drive projects. For a footage-free video use create_motion_graphics_video.")], true);
    const ids = new Set([...analysis.clips.map((c) => c.id), ...analysis.photos.map((p) => p.id)]);
    const problems = themes.flatMap((t, i) => t.shots.filter((s) => !ids.has(s.id)).map((s) => `theme ${i + 1}: unknown shot id ${s.id}`));
    if (problems.length) return reply([text(`Fix these and call again: ${problems.join("; ")}`)], true);
    if (new Set(themes.map((t) => t.styleId)).size < Math.min(3, themes.length)) {
      return reply([text("Use at least three different styleIds so the options feel distinct.")], true);
    }
    const arcs = themes.map((t) => t.shots.map((s) => s.id).join(","));
    if (new Set(arcs).size < themes.length || new Set(themes.map((t) => t.shots[0].id + "|" + t.shots[t.shots.length - 1].id)).size < themes.length) {
      return reply([text("Two themes open and close on the same shots. Give each theme its own story: a different opener or closer, and a different order of moments.")], true);
    }

    if (clip_notes) {
      for (const c of analysis.clips) if (clip_notes[c.id]) c.notes = clip_notes[c.id];
      for (const p of analysis.photos) if (clip_notes[p.id]) p.notes = clip_notes[p.id];
      fs.writeFileSync(path.join(projectDir(project_id), "analysis.json"), JSON.stringify(analysis, null, 2));
    }
    const profile = occasionProfile(analysis.occasion);
    const clashing = themes.filter((t) => profile.avoid.includes(t.styleId));
    if (clashing.length > 1 || !themes.some((t) => profile.styles.includes(t.styleId))) {
      return reply(
        [text(`These styles don't suit ${profile.label}. Build most themes on ${profile.styles.join(", ")}${profile.avoid.length ? ` and avoid ${profile.avoid.join(", ")}` : ""}, then call again.`)],
        true,
      );
    }
    const saved: Theme[] = themes.map((t, i) => ({ ...t, id: `t${i + 1}` }));
    project.themes = saved;
    saveProject(project);

    // One still per theme (its title card over its footage, in its style) so the user can choose by eye.
    const content: Content[] = [text(`Saved ${saved.length} themes for ${project_id}. Show the user each option with its preview and ask which to make:`)];
    const startedAt = Date.now();
    for (const t of saved) {
      const { plan } = buildPlan(analysis, t);
      const beat = plan.music ? ` · cuts on the beat at ${plan.music.bpm} BPM` : "";
      content.push(
        text(
          `**${t.id} · ${t.name}** (${STYLES[t.styleId].name}, ${plan.aspect})\n${t.pitch}\nStory: ${t.story}\nFits the occasion: ${t.occasionFit}\nTitle: "${t.title}"${t.subtitle ? ` / "${t.subtitle}"` : ""} · Ends with: "${t.outroText}" · ${plan.scenes.length} shots (${t.shots.length} hand-picked)${beat}`,
        ),
      );
      if (Date.now() - startedAt > 40_000) continue; // keep the tool call responsive
      const still = path.join(projectDir(project_id), "previews", `${t.id}.jpg`);
      try {
        fs.mkdirSync(path.dirname(still), { recursive: true });
        await renderPreviewStill({ plan: { ...plan, music: null }, assetDir: projectDir(project_id), outFile: still });
        content.push(image(still));
      } catch (e) {
        console.error(`preview for ${t.id} failed:`, e);
      }
    }
    return reply(content);
  },
);

server.registerTool(
  "generate_video",
  {
    title: "Generate the video",
    description:
      "Builds the edit for the chosen theme (your curated shots, gaps filled with the best moments, every cut on the soundtrack's beat, transitions, titles, colour grade), renders a 1080p MP4 at -14 LUFS and publishes it to the website with an editor. Takes 1–5 minutes; returns a job id to poll with check_job if it runs long.",
    inputSchema: {
      project_id: z.string(),
      theme_id: z.string().describe("t1, t2, … from propose_themes"),
      duration_seconds: z.number().min(8).max(300).optional().describe("Override the target length"),
      changes: ThemeInput.partial().optional().describe("Optional tweaks to the theme before rendering, e.g. a new title or shot list"),
    },
  },
  async ({ project_id, theme_id, duration_seconds, changes }) => {
    const project = loadProject(project_id);
    const base = project.themes.find((t) => t.id === theme_id);
    if (!base) return reply([text(`No theme "${theme_id}". Known: ${project.themes.map((t) => t.id).join(", ") || "none — call propose_themes first"}`)], true);
    const running = activeJobFor(project_id, "generate");
    if (running) return reply([text(`A render is already running for this project (job ${running.id}). Use check_job.`)], true);
    const theme: Theme = { ...base, ...changes, id: base.id };
    if (changes) {
      project.themes = project.themes.map((t) => (t.id === theme.id ? theme : t));
      saveProject(project);
    }
    const job = startJob("generate", project_id, (update) => generateFromTheme(project_id, theme, duration_seconds, update));
    return describeJob(await waitForJob(job.id, WAIT_MS));
  },
);

server.registerTool(
  "create_motion_graphics_video",
  {
    title: "Create a motion-graphics video (no footage)",
    description:
      "Fallback route when there is no usable Drive footage: renders an animated, footage-free launch-film-style video from scenes you write (e.g. a product promo for StudyHub): kinetic headlines, feature icons, animated stats, product screenshots in device frames, all cut to a generated soundtrack. Ask the user for the product link first and read it, so the scenes describe real features. Publishes to the website like generate_video.",
    inputSchema: {
      title: z.string().max(60),
      subtitle: z.string().max(100).optional(),
      occasion: z.string().max(80).describe("e.g. 'StudyHub product launch'"),
      style_id: z.enum(STYLE_IDS),
      aspect: AspectRatio.default("16:9"),
      duration_seconds: z.number().min(10).max(180),
      outro_text: z.string().max(60).describe("Closing line / call to action"),
      accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      source_url: z.string().optional().describe("The link the content came from"),
      scenes: z
        .array(
          z.object({
            layout: z
              .enum(["statement", "bullets", "stat", "quote", "feature", "screenshot"])
              .optional()
              .describe("statement: big kinetic headline · bullets: list revealed on the beat · stat: animated counter · quote: testimonial (heading = quote, body = who) · feature: icon + headline · screenshot: product image in a device frame"),
            kicker: z.string().max(24).optional().describe("Small label above the heading, e.g. 'FOR STUDENTS'"),
            heading: z.string().max(80),
            body: z.string().max(220).optional(),
            bullets: z.array(z.string().max(60)).max(4).optional(),
            stat: z.object({ value: z.number(), prefix: z.string().max(4).optional(), suffix: z.string().max(6).optional(), label: z.string().max(40) }).optional(),
            icon: z.enum(CARD_ICONS).optional(),
            image_url: z.string().url().optional().describe("For screenshot scenes: a real screenshot/image URL from the product's site"),
            device: z.enum(["laptop", "phone"]).optional(),
          }),
        )
        .min(4)
        .max(10)
        .describe("6–8 scenes work best. Mix layouts like a launch film: a statement opener, 2–3 feature scenes with icons, one stat with a real number from the site, a screenshot of the product, a bullets or quote scene, then the outro carries the call to action. Only use facts from the product's site."),
    },
  },
  async (a) => {
    const project = createProject({ mode: "motion", source: a.source_url, occasion: a.occasion, targetDuration: a.duration_seconds });
    const job = startJob("generate", project.id, (update) =>
      generateMotionGraphics(
        project.id,
        {
          title: a.title,
          subtitle: a.subtitle,
          occasion: a.occasion,
          styleId: a.style_id,
          aspect: a.aspect,
          durationSeconds: a.duration_seconds,
          outroText: a.outro_text,
          accentColor: a.accent_color,
          sourceUrl: a.source_url,
          scenes: a.scenes,
        },
        update,
      ),
    );
    return describeJob(await waitForJob(job.id, WAIT_MS));
  },
);

server.registerTool(
  "get_project",
  {
    title: "Get project status",
    description: "Returns a project's inputs, saved themes and published videos.",
    inputSchema: { project_id: z.string() },
  },
  async ({ project_id }) => {
    const p = loadProject(project_id);
    return reply([text(JSON.stringify({ ...p, site: siteUrl() }, null, 2))]);
  },
);

server.registerPrompt(
  "make_video",
  {
    title: "Make a video from a Drive folder",
    description: "Start the Drive → themed video workflow",
    argsSchema: {
      drive_link: z.string().describe("Google Drive folder link"),
      duration_seconds: z.string().describe("Target length in seconds"),
      occasion: z.string().describe("What the video is for"),
    },
  },
  ({ drive_link, duration_seconds, occasion }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Make a ${duration_seconds}-second video for "${occasion}" from this Google Drive folder: ${drive_link}. Analyse the footage, suggest 3–4 themes for me to choose from, then generate the one I pick.`,
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
console.error(`drive-reel MCP server ready (site: ${siteUrl()})`);

export { getJob };
