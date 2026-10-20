/**
 * Usage: tsx render/cli.ts <plan.json> <assetDir> <out.mp4> [poster.jpg]
 * Prints `PROGRESS <0..1>` lines and a final `DONE <json>` line, so the website can run it as a child process.
 */
import fs from "node:fs";
import { EditPlan } from "../shared/plan";
import { renderPlan } from "./render";

const [planFile, assetDir, outFile, posterFile] = process.argv.slice(2);
if (!planFile || !assetDir || !outFile) {
  console.error("usage: tsx render/cli.ts <plan.json> <assetDir> <out.mp4> [poster.jpg]");
  process.exit(2);
}

const plan = EditPlan.parse(JSON.parse(fs.readFileSync(planFile, "utf8")));
let last = -1;
renderPlan({
  plan,
  assetDir,
  outFile,
  posterFile,
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
