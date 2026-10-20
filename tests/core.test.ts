import assert from "node:assert/strict";
import { test } from "node:test";
import { EditPlan, isSafeAssetPath, planDurationInFrames, resolveAsset, timelineSegments, transitionFrames } from "../shared/plan";
import { parseEmbeddedFolderView, parseSource, mediaKind } from "../mcp/drive";
import { spreadPick } from "../mcp/analyze";
import { buildPlan, cutTimes, type Theme } from "../mcp/planner";
import { onsetEnvelope, tempoFromEnvelope } from "../mcp/beats";
import { synthesizeTrack } from "../mcp/music";
import { STYLES } from "../shared/styles";
import { localName } from "../mcp/drive";
import { musicFor, occasionProfile } from "../shared/occasions";
import { parseRange } from "../render/static-server";
import { demoPlan } from "../remotion/demo-plan";
import type { Analysis, ClipInfo } from "../mcp/analyze";

test("plan duration subtracts transition overlaps", () => {
  // intro 3s + 3 cards × 3s + outro 2.5s = 14.5s = 435 frames; 4 wipes × 15 frames overlap.
  assert.equal(planDurationInFrames(demoPlan), 435 - 4 * 15);
});

test("transitions are clamped to half the shorter neighbour", () => {
  const plan = { ...demoPlan, transition: { type: "fade" as const, duration: 1.5 } };
  assert.equal(transitionFrames(plan, 20, 90), 10);
  assert.equal(transitionFrames({ ...plan, transition: { type: "none", duration: 1 } }, 90, 90), 0);
});

test("assets resolve against the base unless already absolute", () => {
  assert.equal(resolveAsset({ assetBase: "/media/abc" }, "assets/v1.mp4"), "/media/abc/assets/v1.mp4");
  assert.equal(resolveAsset({ assetBase: "" }, "assets/v1.mp4"), "assets/v1.mp4");
  assert.equal(resolveAsset({ assetBase: "/x" }, "https://cdn/x.mp4"), "https://cdn/x.mp4");
});

test("drive links of every common shape parse", () => {
  assert.deepEqual(parseSource("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing"), { kind: "folder", id: "1AbCdEfGhIjKlMnOpQ" });
  assert.deepEqual(parseSource("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQ"), { kind: "folder", id: "1AbCdEfGhIjKlMnOpQ" });
  assert.deepEqual(parseSource("https://drive.google.com/file/d/1vvB7n7K5zn7eX4twcPrGx7rgXDjNf1cK/view"), { kind: "file", id: "1vvB7n7K5zn7eX4twcPrGx7rgXDjNf1cK" });
  assert.deepEqual(parseSource("https://drive.google.com/open?id=1vvB7n7K5zn7eX4twcPrGx7rgXDjNf1cK"), { kind: "file", id: "1vvB7n7K5zn7eX4twcPrGx7rgXDjNf1cK" });
  assert.throws(() => parseSource("https://example.com/video.mp4"));
});

test("embedded folder view HTML is parsed into files and folders", () => {
  const html = `<div class="flip-entries">
    <div class="flip-entry" id="entry-1aaaaaaaaaaaaaaaaaaaa" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1aaaaaaaaaaaaaaaaaaaa/view?usp=drive_web" target="_blank"><div class="flip-entry-title">Stage &amp; crowd.mp4</div></a></div></div>
    <div class="flip-entry" id="entry-1bbbbbbbbbbbbbbbbbbbb" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/1bbbbbbbbbbbbbbbbbbbb" target="_blank"><div class="flip-entry-title">Day 2</div></a></div></div>
  </div>`;
  assert.deepEqual(parseEmbeddedFolderView(html), [
    { id: "1aaaaaaaaaaaaaaaaaaaa", name: "Stage & crowd.mp4", isFolder: false },
    { id: "1bbbbbbbbbbbbbbbbbbbb", name: "Day 2", isFolder: true },
  ]);
});

test("media kinds include phone and camera formats", () => {
  assert.equal(mediaKind("IMG_0256.MOV"), "video");
  assert.equal(mediaKind("IMG_1519.HEIC"), "image");
  assert.equal(mediaKind("DSC_0004.NEF"), "image");
  assert.equal(mediaKind("song.mp3"), "audio");
  assert.equal(mediaKind("notes.pdf"), "other");
});

test("spreadPick samples every sub-folder and across each folder", () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({ folder: "A", n: i })),
    ...Array.from({ length: 2 }, (_, i) => ({ folder: "B", n: i })),
    ...Array.from({ length: 10 }, (_, i) => ({ folder: "C", n: i })),
  ];
  const picked = spreadPick(items, 8);
  assert.equal(picked.length, 8);
  assert.deepEqual([...new Set(picked.map((p) => p.folder))].sort(), ["A", "B", "C"]);
  const a = picked.filter((p) => p.folder === "A").map((p) => p.n);
  assert.ok(Math.max(...a) - Math.min(...a) >= 10, "A's picks should span its timeline");
});

test("range header parsing", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.equal(parseRange("bytes=5-1", 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

function fakeClip(id: string, duration: number): ClipInfo {
  const n = Math.ceil(duration / 0.5);
  return {
    id, kind: "video", name: `${id}.mp4`, folder: "", duration, width: 1920, height: 1080, orientation: "landscape", hasAudio: true,
    proxy: `assets/${id}.mp4`, sheet: "", sheetTimes: [], energy: Array.from({ length: n }, (_, i) => (i % 5) / 5), motion: Array.from({ length: n }, (_, i) => ((i * 3) % 7) / 7),
    quality: Array.from({ length: n }, () => 1), cuts: [], highlights: [], audioLevel: "lively",
  };
}

const analysis: Analysis = {
  projectId: "prj-test", source: "x", occasion: "Test", targetDuration: 30, suggestedAspect: "16:9",
  clips: [fakeClip("v1", 12), fakeClip("v2", 9), fakeClip("v3", 20)],
  photos: [{ id: "p4", kind: "image", name: "a.jpg", folder: "", width: 1600, height: 1200, proxy: "assets/p4.jpg" }],
  audio: [], skipped: [], totals: { footageSeconds: 41, files: 4 }, createdAt: "",
};

for (const styleId of ["hype", "cinematic", "nostalgic"] as const) {
  test(`planner hits the target length (${styleId})`, () => {
    const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId, title: "T", outroText: "Bye", shots: [{ id: "v1" }, { id: "v3" }, { id: "v2" }] };
    const { plan } = buildPlan(analysis, theme);
    EditPlan.parse(plan);
    const secs = planDurationInFrames(plan) / plan.fps;
    assert.ok(Math.abs(secs - 30) < 1, `got ${secs}s`);
    for (const s of plan.scenes) {
      if (s.kind === "video") assert.ok(s.trimStart + s.duration * s.speed <= s.sourceDuration + 0.01, `shot ${s.id} runs past its clip`);
    }
    assert.ok(new Set(plan.scenes.filter((s) => s.kind === "video").map((s) => s.src)).size === 3, "every clip is used");
  });
}

test("planner follows Claude's curated shot order", () => {
  const theme: Theme = {
    id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId: "clean", title: "T", outroText: "Bye",
    shots: [{ id: "v3", start: 4, caption: "Opening" }, { id: "p4" }, { id: "v1" }],
  };
  const { plan } = buildPlan(analysis, theme, { durationOverride: 12 });
  assert.equal(plan.scenes[0].kind === "video" && plan.scenes[0].src, "assets/v3.mp4");
  assert.equal(plan.scenes[0].caption, "Opening");
  assert.equal(plan.scenes[1].kind, "image");
});

for (const styleId of ["hype", "cinematic", "elegant"] as const) {
  test(`every cut lands on the music's beat (${styleId})`, () => {
    const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId, title: "T", outroText: "Bye", shots: [{ id: "v1" }, { id: "p4" }, { id: "v3" }] };
    const { plan } = buildPlan(analysis, theme);
    const beat = 60 / plan.music!.bpm;
    const cuts = cutTimes(plan, timelineSegments(plan), (a, b) => transitionFrames(plan, a, b));
    // All cuts except the last (into the outro, which absorbs the remainder) sit within one frame of a beat.
    for (const c of cuts.slice(0, -1)) {
      const off = Math.abs(c / beat - Math.round(c / beat)) * beat;
      assert.ok(off <= 1.01 / plan.fps, `cut at ${c.toFixed(3)}s is ${(off * 1000).toFixed(0)}ms off the beat`);
    }
  });
}

test("a Drive song's detected tempo and first beat drive the grid", () => {
  const withSong: Analysis = { ...analysis, audio: [{ id: "a9", kind: "audio", name: "song.mp3", duration: 60, proxy: "assets/a9.m4a", bpm: 100, beatOffset: 0.3 }] };
  const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId: "hype", title: "T", outroText: "Bye", shots: [{ id: "v1" }, { id: "v2" }, { id: "v3" }] };
  const { plan } = buildPlan(withSong, theme);
  assert.equal(plan.music!.bpm, 100);
  const cuts = cutTimes(plan, timelineSegments(plan), (a, b) => transitionFrames(plan, a, b));
  for (const c of cuts.slice(0, -1)) {
    const k = (c - 0.3) / 0.6;
    assert.ok(Math.abs(k - Math.round(k)) * 0.6 <= 1.01 / 30, `cut at ${c}s is off the shifted grid`);
  }
});

test("tempo detection recovers the generated tracks' BPM", () => {
  for (const id of ["hype", "cinematic", "playful"] as const) {
    const [L, R] = synthesizeTrack(STYLES[id].music, 30);
    // synthesizeTrack runs at 44.1 kHz; detection expects 22.05 kHz, so mix to mono and average sample pairs (a cheap low-pass), as ffmpeg does in detectBeats.
    const mono = new Float32Array(Math.floor(L.length / 2)).map((_, i) => (L[i * 2] + L[i * 2 + 1] + R[i * 2] + R[i * 2 + 1]) / 4);
    const { bpm } = tempoFromEnvelope(onsetEnvelope(mono));
    assert.ok(Math.abs(bpm - STYLES[id].music.bpm) < 2, `${id}: expected ${STYLES[id].music.bpm}, got ${bpm}`);
  }
});

test("same-named files from different folders get different local names", () => {
  assert.notEqual(localName({ id: "1aaaaaaaaaaaaaaaaaaaa" }, "IMG_0001.MOV"), localName({ id: "1bbbbbbbbbbbbbbbbbbbb" }, "IMG_0001.MOV"));
});

test("asset paths must stay relative and inside the video folder", () => {
  assert.ok(isSafeAssetPath("assets/v1.mp4"));
  assert.ok(isSafeAssetPath("sheets/v1.jpg"));
  for (const bad of ["http://example.com/x.mp3", "file:///etc/passwd", "../meta.json", "assets/../../x", "/etc/passwd", "C:/x.mp4", "data:audio/wav;base64,AA"]) {
    assert.ok(!isSafeAssetPath(bad), bad);
  }
});

test("the occasion picks a profile that steers styles and music", () => {
  assert.equal(occasionProfile("VinHack 2026 hackathon aftermovie").id, "hackathon");
  assert.equal(occasionProfile("Riya's 21st birthday").id, "birthday");
  assert.equal(occasionProfile("Ananya & Rohan's wedding reception").id, "wedding");
  assert.equal(occasionProfile("In loving memory of Grandpa").id, "memorial");
  assert.equal(occasionProfile("Nature walk").id, "travel");
  assert.equal(occasionProfile("Saturday with friends").id, "general");
  // A memorial gets a slower track with no drums, whatever style it's built on.
  const m = musicFor(STYLES.hype, "In loving memory of Grandpa");
  assert.equal(m.drums, "none");
  assert.ok(m.bpm < STYLES.hype.music.bpm);
  assert.deepEqual(musicFor(STYLES.hype, "VinHack 2026"), STYLES.hype.music);
});
