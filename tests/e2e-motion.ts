/** Exercises the footage-free route: tsx tests/e2e-motion.ts */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "e2e-motion", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"], stderr: "inherit" }));
type R = { content: { type: string; text?: string }[]; isError?: boolean };
const text = (r: R) => r.content.map((c) => c.text ?? "").join("\n");
let r = (await client.callTool(
  {
    name: "create_motion_graphics_video",
    arguments: {
      title: "StudyHub",
      subtitle: "Everything you need to ace the semester",
      occasion: "Product demo",
      style_id: "clean",
      aspect: "16:9",
      duration_seconds: 20,
      outro_text: "Start studying smarter",
      scenes: [
        { kicker: "The problem", heading: "Notes everywhere, nothing in one place", body: "Group chats, drives and screenshots: finding the right material takes longer than studying it." },
        { kicker: "Meet StudyHub", heading: "One hub for every course", bullets: ["Shared notes", "Past papers", "Deadlines"] },
        { kicker: "Why it works", heading: "Built by students, for students", body: "Organised by course and semester, searchable in seconds." },
      ],
    },
  },
  undefined,
  { timeout: 600_000 },
)) as R;
while (/job_id "(job_\w+)"/.test(text(r))) {
  r = (await client.callTool({ name: "check_job", arguments: { job_id: text(r).match(/job_id "(job_\w+)"/)![1] } }, undefined, { timeout: 600_000 })) as R;
}
console.log(r.isError ? "ERROR" : "OK", text(r));
await client.close();
if (r.isError) process.exit(1);
