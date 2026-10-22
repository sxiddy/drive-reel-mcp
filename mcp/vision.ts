import fs from "node:fs";
import path from "node:path";
import { ffmpeg } from "./media";

/**
 * Local vision model (Qwen2.5-VL 7B through Ollama on this machine): looks at one frame of each clip and
 * each photo and says what kind of shot it is. Runs only on the laptop, never on a paid API; when Ollama
 * isn't running the analysis simply goes without it.
 */
export const VISION_MODEL = process.env.VISION_MODEL ?? "qwen2.5vl:7b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

export type ShotKind = "wide" | "stage" | "crowd" | "group" | "closeup" | "screen" | "other";
export type Vision = {
  /** wide: the venue or hall from far; stage: someone presenting; crowd: an audience; group: people posing together. */
  shot: ShotKind;
  people: number;
  dark: boolean;
  /** How good a frame it is for an aftermovie, 1..10. */
  appeal: number;
  caption: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    shot: { type: "string", enum: ["wide", "stage", "crowd", "group", "closeup", "screen", "other"] },
    people: { type: "integer" },
    dark: { type: "boolean" },
    appeal: { type: "integer" },
    caption: { type: "string" },
  },
  required: ["shot", "people", "dark", "appeal", "caption"],
};

const PROMPT = `This is one frame from event footage for an aftermovie. Answer in JSON:
shot: "wide" (the venue or hall seen from far), "stage" (a speaker or performer), "crowd" (an audience or many people), "group" (people posing together for the camera), "closeup" (one or two people close), "screen" (a laptop, slides or a screen fills the frame), or "other";
people: how many people are visible;
dark: true if the frame is too dark to see what's happening;
appeal: 1-10, how good this frame would look in a polished aftermovie (sharp, well lit, interesting);
caption: at most 8 words saying what is shown.`;

/** True when Ollama is up and has the vision model. */
export async function visionAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { models?: { name: string }[] };
    return !!j.models?.some((m) => m.name === VISION_MODEL || m.name.startsWith(`${VISION_MODEL}`));
  } catch {
    return false;
  }
}

const clampInt = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);

/** Reads the model's answer, tolerating missing or odd fields. */
export function parseVision(raw: string): Vision | undefined {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const kinds: ShotKind[] = ["wide", "stage", "crowd", "group", "closeup", "screen", "other"];
    return {
      shot: kinds.includes(j.shot as ShotKind) ? (j.shot as ShotKind) : "other",
      people: clampInt(j.people, 0, 200, 0),
      dark: j.dark === true,
      appeal: clampInt(j.appeal, 1, 10, 5),
      caption: typeof j.caption === "string" ? j.caption.slice(0, 80) : "",
    };
  } catch {
    return undefined;
  }
}

/** Describes one image file (a JPEG frame). */
export async function describeImage(file: string, timeoutMs = 180_000): Promise<Vision | undefined> {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: VISION_MODEL, prompt: PROMPT, images: [fs.readFileSync(file).toString("base64")], format: SCHEMA, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  return parseVision(((await r.json()) as { response?: string }).response ?? "");
}

/** One 768 px frame of a video (or a photo) to show the model. */
export async function visionFrame(src: string, out: string, at?: number) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ffmpeg([...(at !== undefined ? ["-ss", at.toFixed(2)] : []), "-i", src, "-vf", "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", "-frames:v", "1", "-q:v", "4", out]);
  return out;
}

/**
 * How much the model's view changes a shot's score: appeal 1..10 maps to 0.7..1.15, a dark frame or a
 * screen-only shot counts less.
 */
export function visionFactor(v: Vision | undefined) {
  if (!v) return 1;
  return (0.65 + 0.05 * v.appeal) * (v.dark ? 0.5 : 1) * (v.shot === "screen" ? 0.8 : 1);
}
