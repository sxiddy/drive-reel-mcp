/**
 * End-to-end check that talks to the MCP server exactly like Claude does.
 * Usage: tsx tests/e2e-client.ts <drive link or local folder> [seconds] [styleForFirstTheme]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [source = "work/sample", seconds = "20", style = "nostalgic"] = process.argv.slice(2);
const client = new Client({ name: "e2e", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"],
    stderr: "inherit",
    // Local folders are refused unless explicitly allowed (development only).
    env: { ...(process.env as Record<string, string>), ...(/^https?:/.test(source) ? {} : { ALLOW_LOCAL_SOURCES: "1" }) },
  }),
);

type R = { content: { type: string; text?: string }[]; isError?: boolean };
const textOf = (r: R) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
async function call(name: string, args: Record<string, unknown>) {
  const t0 = Date.now();
  let r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 })) as R;
  let t = textOf(r);
  while (/Call check_job with job_id "(job_\w+)"/.test(t)) {
    const job = t.match(/job_id "(job_\w+)"/)![1];
    console.log(`  … ${t.split("\n")[0]}`);
    r = (await client.callTool({ name: "check_job", arguments: { job_id: job } }, undefined, { timeout: 600_000 })) as R;
    t = textOf(r);
  }
  console.log(`\n## ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.content.filter((c) => c.type === "image").length} images${r.isError ? ", ERROR" : ""})\n${t.slice(0, 2500)}`);
  if (r.isError) process.exit(1);
  return t;
}

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const a = await call("analyze_drive_folder", { drive_link: source, duration_seconds: Number(seconds), occasion: "VinHack 2026 hackathon aftermovie" });
const projectId = a.match(/Project (prj-\w+)/)![1];
// What Claude would do after looking at the sheets: describe clips, then curate a different arc per theme.
const clipIds = [...a.matchAll(/^- (v\d+) ·/gm)].map((m) => m[1]);
const photoIds = [...a.matchAll(/\b(p\d+) \(/g)].map((m) => m[1]);
const ids = [...clipIds, ...photoIds];
const at = (i: number) => ids[((i % ids.length) + ids.length) % ids.length];
const arc = (o: number) => [{ id: at(o), caption: "Day one" }, { id: at(o + 2) }, { id: at(o + 4), caption: "The final push" }, { id: at(o - 1) }];
await call("propose_themes", {
  project_id: projectId,
  clip_notes: Object.fromEntries(ids.map((id) => [id, `Test note for ${id}`])),
  themes: [
    { name: "Golden Hours", pitch: "Warm film look, handwritten captions, the hackathon remembered like a home movie.", story: "Opens on arrival, builds through the night, closes on the group photo.", occasionFit: "An aftermovie people rewatch for the memories.", styleId: style, title: "VinHack 2026", subtitle: "36 hours we won't forget", outroText: "Until next year", shots: arc(0) },
    { name: "Ship It", pitch: "Punchy cuts on every beat and big type for maximum energy.", story: "Cold open on the loudest moment, rapid montage, ends on the win.", occasionFit: "Hackathons run on adrenaline; this cut does too.", styleId: "hype", title: "VINHACK 2026", outroText: "See you next year", shots: arc(1) },
    { name: "The Long Night", pitch: "Letterboxed and slow, the night told like a film.", story: "Quiet start, long takes through the night, sunrise ending.", occasionFit: "Treats the 36 hours like a feature film.", styleId: "cinematic", title: "VinHack 2026", outroText: "Fin.", shots: arc(2) },
  ],
});
await call("generate_video", { project_id: projectId, theme_id: "t1" });
await client.close();
