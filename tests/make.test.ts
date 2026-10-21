import assert from "node:assert/strict";
import { test } from "node:test";
import { autoThemes } from "../mcp/claude";
import { ThemeInput } from "../mcp/planner";
import { isDriveLink, isMakeId } from "../shared/make";
import { occasionProfile } from "../shared/occasions";
import type { Analysis } from "../mcp/analyze";

const clip = (id: string, energy: number, motion: number, quality = 0.9) =>
  ({
    id,
    name: `${id}.mp4`,
    duration: 12,
    energy: Array(24).fill(energy),
    motion: Array(24).fill(motion),
    quality: Array(24).fill(quality),
    highlights: [{ start: 2, end: 5, score: energy }],
  }) as unknown as Analysis["clips"][number];

const analysis = (occasion: string, clips: Analysis["clips"]) => ({ occasion, clips, photos: [], audio: [] }) as unknown as Analysis;

test("built-in themes are valid, distinct and suit the occasion", () => {
  const a = analysis("Riya's 21st birthday", [clip("v1", 0.2, 0.1), clip("v2", 0.9, 0.8), clip("v3", 0.5, 0.4), clip("v4", 0.3, 0.2)]);
  const { themes, by } = autoThemes(a);
  assert.equal(by, "auto");
  assert.equal(themes.length, 3);
  for (const t of themes) ThemeInput.parse(t);
  assert.equal(new Set(themes.map((t) => t.styleId)).size, 3, "three different styles");
  const profile = occasionProfile(a.occasion);
  assert.ok(themes.every((t) => !profile.avoid.includes(t.styleId)), "no clashing style");
  assert.equal(new Set(themes.map((t) => `${t.shots[0].id}|${t.shots.at(-1)!.id}`)).size, 3, "each opens and closes differently");
  // The loudest, busiest clip is every theme's peak.
  assert.ok(themes.every((t) => t.shots[1].id === "v2"));
});

test("built-in themes work with a single clip and refuse an empty folder", () => {
  const { themes } = autoThemes(analysis("Trip", [clip("v1", 0.5, 0.5)]));
  for (const t of themes) ThemeInput.parse(t);
  assert.throws(() => autoThemes(analysis("Trip", [])), /no usable/);
});

test("the website only accepts Drive links and long random job ids", () => {
  assert.ok(isDriveLink("https://drive.google.com/drive/folders/abc"));
  assert.ok(!isDriveLink("http://drive.google.com/drive/folders/abc"), "https only");
  assert.ok(!isDriveLink("C:/Users/me/Videos"));
  assert.ok(!isDriveLink("https://drive.google.com.evil.example/x"));
  assert.ok(!isDriveLink("file:///etc/passwd"));
  assert.ok(isMakeId("web-" + "a1".repeat(12)));
  assert.ok(!isMakeId("web-123"));
  assert.ok(!isMakeId("prj-93f0ff"));
  assert.ok(!isMakeId("web-" + "a1".repeat(12) + "/../x"));
});
