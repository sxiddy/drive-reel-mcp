/**
 * CLIP (openai/clip-vit-base-patch32, run locally through transformers.js) scores a frame against a few
 * plain-English descriptions: how good a shot it looks, and whether it's the venue, a group or a dark frame.
 * Fast enough (well under a second a frame on a laptop CPU) to look at every shot, which the 7B vision
 * model can't. The model (~350 MB) downloads once into the transformers cache. Local only: no paid API.
 */
export const CLIP_MODEL = process.env.CLIP_MODEL ?? "Xenova/clip-vit-base-patch32";

export type ClipScores = {
  /** 0..1: "a beautiful, well-lit professional photo" against "a blurry, badly lit amateur photo". */
  aesthetic: number;
  /** 0..1 share of each role among the role prompts. */
  wide: number;
  group: number;
  dark: number;
};

const AESTHETIC = ["a beautiful, sharp, well-lit professional event photo", "a blurry, badly lit, boring amateur photo"];
const ROLES = ["a wide shot of a big event hall or venue", "a group of people posing together for a photo", "a very dark photo where nothing is visible", "a close-up of a person", "a laptop or projector screen"];

type Classifier = (image: string, labels: string[]) => Promise<{ label: string; score: number }[]>;
let classifier: Promise<Classifier | null> | undefined;

/** The zero-shot pipeline, loaded once; null when transformers.js or the model can't load. */
function load() {
  classifier ??= (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      return (await pipeline("zero-shot-image-classification", CLIP_MODEL, { dtype: "q8" })) as unknown as Classifier;
    } catch (e) {
      console.error("CLIP unavailable:", (e as Error).message);
      return null;
    }
  })();
  return classifier;
}

export async function clipAvailable() {
  return (await load()) !== null;
}

/** Scores one image file, or undefined when CLIP isn't available. */
export async function clipScore(file: string): Promise<ClipScores | undefined> {
  const c = await load();
  if (!c) return undefined;
  const of = (rs: { label: string; score: number }[], l: string) => rs.find((r) => r.label === l)?.score ?? 0;
  const a = await c(file, AESTHETIC);
  const r = await c(file, ROLES);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { aesthetic: round(of(a, AESTHETIC[0])), wide: round(of(r, ROLES[0])), group: round(of(r, ROLES[1])), dark: round(of(r, ROLES[2])) };
}

/** Score multiplier from CLIP's view: aesthetic 0..1 maps to 0.75..1.15; a frame it calls dark counts half. */
export function clipFactor(s: ClipScores | undefined) {
  if (!s) return 1;
  return (0.75 + 0.4 * s.aesthetic) * (s.dark > 0.5 ? 0.5 : 1);
}
