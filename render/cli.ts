/**
 * Usage: tsx render/cli.ts <plan.json> <assetDir> <out.mp4> [poster.jpg] [--scale 2]
 * Prints `PROGRESS <0..1>` lines and a final `DONE <json>` line, so the website can run it as a child process.
 * `--scale 2` renders at twice the composition size (3840x2160 for a 16:9 plan, i.e. 4K).
 */
import fs from "node:fs";
import { EditPlan } from "../shared/plan";
import { RENDER_SCALES, renderPlan } from "./render";

const USAGE = "usage: tsx render/cli.ts <plan.json> <assetDir> <out.mp4> [poster.jpg] [--scale 1|2]";

const args = process.argv.slice(2);
let scale = 1;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--scale" || a.startsWith("--scale=")) {
    const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
    scale = Number(raw);
    if (!(RENDER_SCALES as readonly number[]).includes(scale)) {
      console.error(`--scale must be one of ${RENDER_SCALES.join(", ")} (got ${raw})`);
      process.exit(2);
    }
  } else if (a.startsWith("--")) {
    console.error(`unknown flag ${a}\n${USAGE}`);
    process.exit(2);
  } else {
    positional.push(a);
  }
}

const [planFile, assetDir, outFile, posterFile] = positional;
if (!planFile || !assetDir || !outFile) {
  console.error(USAGE);
  process.exit(2);
}

const plan = EditPlan.parse(JSON.parse(fs.readFileSync(planFile, "utf8")));
let last = -1;
renderPlan({
  plan,
  assetDir,
  outFile,
  posterFile,
  scale,
  onProgress: (p) => {
    const pct = Math.floor(p * 100);
    if (pct !== last) {
      last = pct;
      console.log(`PROGRESS ${p.toFixed(3)}`);
    }
  },
})
  .then((r) => console.log(`DONE ${JSON.stringify(r)}`))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
