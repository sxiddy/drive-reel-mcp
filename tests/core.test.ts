import assert from "node:assert/strict";
import { test } from "node:test";
import { EditPlan, isSafeAssetPath, planDurationInFrames, resolveAsset, timelineSegments, transitionFrames, type VideoScene } from "../shared/plan";
import { parseEmbeddedFolderView, parseSource, mediaKind } from "../mcp/drive";
import { duplicateClips, spreadPick } from "../mcp/analyze";
import { buildPlan, cutTimes, type Theme } from "../mcp/planner";
import { onsetEnvelope, tempoFromEnvelope } from "../mcp/beats";
import { synthesizeTrack } from "../mcp/music";
import { STYLES } from "../shared/styles";
import { localName } from "../mcp/drive";
import { musicFor, occasionProfile } from "../shared/occasions";
import { parseRange } from "../render/static-server";
import { demoPlan } from "../remotion/demo-plan";
import type { Analysis, ClipInfo } from "../mcp/analyze";
import { detectSpeech, exifOrientation, ORIENT_FILTER } from "../mcp/media";
import { chopOf, folderColor, gradeToward, levelGainDb, photoQuality, PHOTO_MIN, shotLevel, spreadApart } from "../mcp/planner";
import { isTranscriberAvailable, toCaptionCues } from "../mcp/transcribe";
import { musicDuck, sceneVolume, speechTimeline, SPEECH_VOLUME } from "../remotion/audio";

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
  // Fillers may sit between them, but the curated shots keep their order and the closer stays last.
  const photoAt = plan.scenes.findIndex((s) => s.kind === "image");
  assert.ok(photoAt > 0, "the photo comes after the opener");
  const last = plan.scenes.at(-1)!;
  assert.equal(last.kind === "video" && last.src, "assets/v1.mp4");
});

for (const styleId of ["hype", "cinematic", "elegant"] as const) {
  test(`every cut lands on the music's beat (${styleId})`, () => {
    const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId, title: "T", outroText: "Bye", shots: [{ id: "v1" }, { id: "p4" }, { id: "v3" }] };
    const { plan } = buildPlan(analysis, theme);
    // Energy styles cut on half beats.
    const beat = 60 / plan.music!.bpm / (STYLES[styleId].prefer === "energy" ? 2 : 1);
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
    // Hype cuts on half beats of the song's 0.6 s beat.
    const k = (c - 0.3) / 0.3;
    assert.ok(Math.abs(k - Math.round(k)) * 0.3 <= 1.01 / 30, `cut at ${c}s is off the shifted grid`);
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

// ----- Speech -----------------------------------------------------------------------------------------

const SR = 16000;
function synthSpeechScene() {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const len = (s: number) => Math.round(s * SR);
  const resonate = (x: Float32Array, f: number, bw: number) => {
    const r = Math.exp((-Math.PI * bw) / SR);
    const c = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    const y = new Float32Array(x.length);
    for (let i = 0, y1 = 0, y2 = 0; i < x.length; i++) [y2, y1] = [y1, (y[i] = x[i] + c * y1 - r * r * y2)];
    return y;
  };
  // A voice: glottal pulses at a gliding pitch through three formants, switched on and off at syllable rate.
  const syllables = (s: number, f0: number) => {
    const src = new Float32Array(len(s));
    for (let i = 0, ph = 0; i < src.length; i++) if ((ph += (f0 * (1 + 0.15 * Math.sin((2 * Math.PI * 1.3 * i) / SR))) / SR) >= 1) [ph, src[i]] = [ph - 1, 1];
    const [a, b, c] = [resonate(src, 700, 90), resonate(src, 1200, 110), resonate(src, 2500, 160)];
    return a.map((v, i) => {
      const t = (i / SR) % 0.25;
      return t < 0.17 ? (v + 0.6 * b[i] + 0.25 * c[i]) * Math.sin((Math.PI * t) / 0.17) : 0;
    });
  };
  const tone = (s: number, fn: (t: number) => number) => new Float32Array(len(s)).map((_, i) => fn(i / SR));
  const noise = (s: number) => new Float32Array(len(s)).map(() => rnd() * 2 - 1);
  const level = (x: Float32Array, rms: number) => {
    const k = rms / Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length + 1e-20);
    return x.map((v) => v * k);
  };
  const parts = [
    level(resonate(noise(1.5), 80, 60), 0.05), // wind rumble        0.0–1.5
    level(syllables(2, 130), 0.1), // low voice                      1.5–3.5
    new Float32Array(len(1.2)), // pause                             3.5–4.7
    level(syllables(1.5, 210), 0.08), // higher voice                4.7–6.2
    level(tone(2, (t) => [220, 277, 330, 440].reduce((n, f) => n + Math.sin(2 * Math.PI * f * t), 0) * (0.8 + 0.2 * Math.sin(4 * Math.PI * t))), 0.1), // sustained chord 6.2–8.2
    level(tone(2, (t) => { const u = t % 0.2; return u < 0.08 ? Math.sin(2 * Math.PI * (3000 + 8000 * u) * u) * Math.sin((Math.PI * u) / 0.08) : 0; }), 0.1), // bird chirps 8.2–10.2
    level(noise(1.5), 0.05), // hiss                                 10.2–11.7
    new Float32Array(len(1)),
  ];
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) [out.set(p, at), (at += p.length)];
  const bed = level(noise(out.length / SR), 0.003);
  return out.map((v, i) => v + bed[i]);
}

test("speech detection finds the voices and ignores rumble, music, birdsong and hiss", () => {
  const found = detectSpeech(synthSpeechScene(), SR);
  assert.equal(found.length, 2, JSON.stringify(found));
  const expected = [[1.5, 3.5], [4.7, 6.2]];
  found.forEach(([a, b], i) => {
    assert.ok(Math.abs(a - expected[i][0]) < 0.2 && Math.abs(b - expected[i][1]) < 0.2, `segment ${i}: ${a}–${b}`);
  });
  assert.deepEqual(detectSpeech(new Float32Array(SR * 3), SR), [], "silence");
});

/** A talking-head clip: 2.6 s phrases with 0.5 s pauses, all the way through. */
function talkingClip(id: string, duration: number): ClipInfo {
  const speech: [number, number][] = [];
  for (let t = 0.2; t + 2.6 < duration; t += 3.1) speech.push([Math.round(t * 100) / 100, Math.round((t + 2.6) * 100) / 100]);
  return { ...fakeClip(id, duration), speech };
}

for (const styleId of ["hype", "cinematic", "clean"] as const) {
  test(`planner cuts between sentences, keeping length and beat sync (${styleId})`, () => {
    const talky: Analysis = { ...analysis, clips: [talkingClip("v1", 40), talkingClip("v2", 30), talkingClip("v3", 50)], photos: [] };
    const theme: Theme = {
      id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId, title: "T", outroText: "Bye",
      // Claude's chosen starts land mid-phrase on purpose.
      shots: [{ id: "v1", start: 1.2 }, { id: "v3", start: 7.5 }, { id: "v2" }],
    };
    const deaf: Analysis = { ...talky, clips: talky.clips.map((c) => ({ ...c, speech: undefined })) };
    const clipOf = (src: string) => talky.clips.find((c) => c.proxy === src)!;
    const chops = (plan: EditPlan) => plan.scenes.flatMap((s) => (s.kind === "video" ? [chopOf(clipOf(s.src), s.trimStart, s.duration)] : []));
    const before = chops(buildPlan(deaf, theme).plan);
    const { plan } = buildPlan(talky, theme);
    const after = chops(plan);
    assert.ok(before.some((c) => c > 0.2), "the speech-blind plan should cut into phrases (else this test proves nothing)");
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const shown = `${before.map((c) => c.toFixed(2))} -> ${after.map((c) => c.toFixed(2))}`;
    if (styleId === "hype") {
      // 1.6 s shots can't open and close in pauses of nonstop 2.6 s phrases; the planner can only cut nearer the edges.
      assert.ok(sum(after) < sum(before) * 0.6, `chopped speech ${shown}`);
    } else {
      assert.ok(sum(after) < sum(before) * 0.25, `chopped speech ${shown}`);
      // Phrase windows carry ~0.08 s of padding at each end, so a cut within 0.3 s of a phrase edge is at a word boundary.
      assert.ok(after.filter((c) => c > 0.3).length <= 1, `at most one shot may still cut into a sentence: ${shown}`);
    }
    // The guarantees the planner already made still hold.
    assert.ok(Math.abs(planDurationInFrames(plan) / plan.fps - 30) < 1);
    const beat = 60 / plan.music!.bpm / (STYLES[plan.styleId].prefer === "energy" ? 2 : 1);
    for (const c of cutTimes(plan, timelineSegments(plan), (a, b) => transitionFrames(plan, a, b)).slice(0, -1)) {
      assert.ok(Math.abs(c / beat - Math.round(c / beat)) * beat <= 1.01 / plan.fps, `cut at ${c.toFixed(3)}s is off the beat`);
    }
    for (const s of plan.scenes) {
      if (s.kind !== "video") continue;
      assert.ok(s.trimStart >= 0 && s.trimStart + s.duration <= s.sourceDuration + 0.01);
      assert.ok(s.speech?.length, `${s.id} carries its speech windows`);
    }
  });
}

test("speech lifts the clip's audio and ducks the music by 10 dB with short ramps", () => {
  const plan = EditPlan.parse({
    ...demoPlan,
    transition: { type: "none", duration: 0 },
    intro: { duration: 0 },
    scenes: [{ id: "s1", kind: "video", src: "assets/v1.mp4", trimStart: 10, sourceDuration: 60, duration: 4, volume: 0.1, speech: [[11, 12], [30, 31]] }],
  });
  const spans = speechTimeline(plan);
  assert.deepEqual(spans, [[30, 60]], "only the window inside the shot, in timeline frames");
  assert.ok(Math.abs(musicDuck(45, spans, 30) - 10 ** (-10 / 20)) < 1e-9);
  assert.equal(musicDuck(10, spans, 30), 1);
  const mid = musicDuck(27.75, spans, 30);
  assert.ok(mid < 1 && mid > 10 ** (-10 / 20), "ramps rather than steps");
  const scene = plan.scenes[0] as VideoScene;
  assert.equal(sceneVolume(scene, 45, 120, 30), SPEECH_VOLUME);
  assert.equal(sceneVolume(scene, 100, 120, 30), 0.1);
  assert.equal(sceneVolume({ ...scene, volume: 0 }, 45, 120, 30), 0, "a muted shot stays muted");
  assert.deepEqual(speechTimeline({ ...plan, scenes: [{ ...scene, volume: 0 }] }), [], "and doesn't duck the music");
});

// ----- Colour -----------------------------------------------------------------------------------------

/** Mean colour after a grade, applied the way the renderer's SVG filter does (on the shot's mean RGB). */
function applyGrade(c: { luma: number; u: number; v: number }, g: ReturnType<typeof gradeToward>) {
  if (!g) return c;
  const rgb = [c.luma + 1.5748 * c.v, c.luma - 0.1873 * c.u - 0.4681 * c.v, c.luma + 1.8556 * c.u].map((x, i) => Math.min(1, Math.max(0, g.gain[i] * x)) ** g.gamma);
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const out = rgb.map((x) => y + g.saturation * (x - y));
  return { luma: y, u: (out[2] - y) / 1.8556, v: (out[0] - y) / 1.5748 };
}

test("colour grades pull clips toward the folder median, within limits", () => {
  const colours = [
    { luma: 0.22, u: 0.03, v: -0.02, sat: 0.03 }, // dim, blue phone
    { luma: 0.45, u: -0.01, v: 0.01, sat: 0.05 },
    { luma: 0.5, u: -0.03, v: 0.03, sat: 0.07 }, // warm, punchy phone
    { luma: 0.42, u: 0.0, v: 0.0, sat: 0.045 },
  ];
  const a = { clips: colours.map((color, i) => ({ ...fakeClip(`v${i + 1}`, 10), color })), photos: [] };
  const target = folderColor(a)!;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const graded = colours.map((c) => ({ c, g: gradeToward(c, target) }));
  const after = graded.map(({ c, g }) => applyGrade(c, g));
  assert.ok(spread(after.map((c) => c.luma)) < spread(colours.map((c) => c.luma)) * 0.6, "luma spread shrinks");
  assert.ok(spread(after.map((c) => c.u)) < spread(colours.map((c) => c.u)) * 0.75, "blue/yellow cast spread shrinks");
  for (const { g } of graded) {
    if (!g) continue;
    assert.ok(Math.min(...g.gain) === 1 && Math.max(...g.gain) <= 1.1, "white balance never dims a channel or pushes past 10%");
    assert.ok(g.gamma >= 0.75 && g.gamma <= 1.2 && g.saturation >= 0.8 && g.saturation <= 1.25);
  }
  assert.ok(graded[0].g!.gamma < 1, "the dim clip is lifted");
  assert.equal(gradeToward(target, target), undefined, "a clip that already matches is left alone");
});

// ----- Captions ---------------------------------------------------------------------------------------

test("no transcriber is set up yet, and raw segments become readable cues", () => {
  assert.equal(isTranscriberAvailable(), false);
  const long = "so this is the main stage where everything happens and in about an hour the finalists will walk out to present what they built over the weekend";
  const cues = toCaptionCues([{ start: 5, end: 13, text: `  ${long} ` }, { start: 13.2, end: 13.4, text: "wow" }, { start: 14, end: 15, text: "   " }]);
  assert.ok(cues.length >= 3);
  for (const c of cues) assert.ok(c.text.length <= 84 && c.end > c.start && c.end - c.start <= 6.01, JSON.stringify(c));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, "no overlaps");
  assert.equal(cues.map((c) => c.text).join(" "), `${long} wow`);
  assert.ok(cues[cues.length - 1].end - cues[cues.length - 1].start >= 0.8, "short cues are held long enough to read");
});

test("plans with and without the new optional fields both parse", () => {
  EditPlan.parse(demoPlan);
  const s = { id: "s1", kind: "video", src: "assets/v1.mp4", trimStart: 0, sourceDuration: 9, duration: 3, grade: { gain: [1.05, 1, 1], gamma: 0.9, saturation: 1.1 }, speech: [[0.5, 2]], captions: [{ start: 0.5, end: 2, text: "Hello" }] };
  const p = EditPlan.parse({ ...demoPlan, scenes: [s] });
  assert.deepEqual((p.scenes[0] as VideoScene).captions, s.captions);
  assert.throws(() => EditPlan.parse({ ...demoPlan, scenes: [{ ...s, grade: { gain: [3, 1, 1], gamma: 1, saturation: 1 } }] }));
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

// ----- Shot selection and timing ----------------------------------------------------------------------

const hypeTheme = (shots?: Theme["shots"]): Theme => ({ id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId: "hype", title: "T", outroText: "Bye", shots: shots ?? [] });
const videoScenes = (plan: EditPlan) => plan.scenes.filter((s): s is VideoScene => s.kind === "video");

test("two shots of the same clip never play back to back when other footage exists", () => {
  // One long clip dominates: story order alone would stack its shots together.
  const a: Analysis = { ...analysis, clips: [fakeClip("v1", 60), fakeClip("v2", 8), fakeClip("v3", 8)], photos: [] };
  for (const shots of [undefined, [{ id: "v1" }, { id: "v1" }, { id: "v2" }, { id: "v1" }]]) {
    const { plan } = buildPlan(a, hypeTheme(shots), { durationOverride: 20 });
    const srcs = plan.scenes.map((s) => (s.kind === "card" ? "" : s.src));
    const v1 = srcs.filter((s) => s === "assets/v1.mp4").length;
    const others = srcs.length - v1;
    // Possible whenever the other clips can separate every v1 shot.
    if (others >= v1 - 1) for (let i = 1; i < srcs.length; i++) assert.notEqual(srcs[i], srcs[i - 1], `scenes ${i} and ${i + 1} are both ${srcs[i]} (${shots ? "curated" : "auto"})`);
  }
  assert.deepEqual(spreadApart(["a", "a", "a", "b", "c"], (x) => x), ["a", "b", "a", "c", "a"]);
  assert.deepEqual(spreadApart(["a", "a"], (x) => x), ["a", "a"], "nothing to interleave with");
});

test("shots of one clip never overlap or replay footage, even when stretched to fit", () => {
  // Few, short-ish clips for a long video: the fit has to stretch shots.
  const a: Analysis = { ...analysis, clips: [fakeClip("v1", 14), fakeClip("v2", 6)], photos: [] };
  const { plan } = buildPlan(a, hypeTheme([{ id: "v1", start: 2 }, { id: "v1", start: 2.5 }, { id: "v2" }]), { durationOverride: 30 });
  const bySrc = new Map<string, [number, number][]>();
  for (const s of videoScenes(plan)) bySrc.set(s.src, [...(bySrc.get(s.src) ?? []), [s.trimStart, s.trimStart + s.duration]]);
  for (const [src, spans] of bySrc) {
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-6, `${src}: ${JSON.stringify(spans[i - 1])} overlaps ${JSON.stringify(spans[i])}`);
  }
});

test("no shot holds past twice the style's shot length; short footage gives a shorter video, not long shots", () => {
  const style = STYLES.hype;
  const limit = 2 * style.shotLength + style.transition.duration + 0.25;
  // 3 small clips and a photo can't fill 40 s at Hype pace.
  const a: Analysis = { ...analysis, clips: [fakeClip("v1", 4), fakeClip("v2", 4), fakeClip("v3", 5)] };
  const { plan, notes } = buildPlan(a, hypeTheme(), { durationOverride: 40 });
  // The opening shot also carries the title (at most 2.6 s of it) when the title is drawn over it.
  const limitOf = (p: EditPlan, i: number) => limit + (p.opening && i === 0 ? 2.65 : 0);
  plan.scenes.forEach((s, i) => assert.ok(s.duration <= limitOf(plan, i), `${s.id} holds ${s.duration}s`));
  assert.ok(plan.outro.duration <= 1.8 + 1.2 + 0.01, `outro ${plan.outro.duration}s pads the missing footage`);
  assert.ok(notes.some((n) => /only supports/.test(n)));
  // With plenty of footage the shortfall goes to extra shots, and the length is hit.
  const rich: Analysis = { ...analysis, clips: Array.from({ length: 8 }, (_, i) => fakeClip(`v${i + 1}`, 20)) };
  const r = buildPlan(rich, hypeTheme([{ id: "v1" }, { id: "v2" }, { id: "v3" }]), { durationOverride: 15 });
  assert.ok(Math.abs(planDurationInFrames(r.plan) / 30 - 15) < 1);
  r.plan.scenes.forEach((s, i) => assert.ok(s.duration <= limitOf(r.plan, i), `${s.id} holds ${s.duration}s`));
});

test("short clips never shorten their scene; clips under a beat are dropped", () => {
  const a: Analysis = { ...analysis, clips: [fakeClip("v1", 0.6), fakeClip("v2", 1.3), fakeClip("v3", 12), fakeClip("v4", 9)], photos: [] };
  const { plan } = buildPlan(a, hypeTheme([{ id: "v1" }, { id: "v2" }, { id: "v3" }, { id: "v4" }]), { durationOverride: 15 });
  assert.ok(!plan.scenes.some((s) => s.kind === "video" && s.src === "assets/v1.mp4"), "a clip shorter than a beat is left out");
  const segs = timelineSegments(plan);
  for (const s of videoScenes(plan)) {
    assert.ok(s.trimStart >= 0 && s.trimStart + s.duration <= s.sourceDuration + 1e-6, `${s.id} runs past its clip`);
    assert.equal(Math.round(s.duration * 30), segs.find((g) => g.key === s.id)!.frames, `${s.id} keeps its full slot`);
  }
  // Every cut still on the (half-)beat.
  const beat = 60 / plan.music!.bpm / 2;
  for (const c of cutTimes(plan, segs, (x, y) => transitionFrames(plan, x, y)).slice(0, -1)) {
    assert.ok(Math.abs(c / beat - Math.round(c / beat)) * beat <= 1.01 / 30, `cut at ${c}s is off the beat`);
  }
});

test("clip loudness is evened out toward the edit's typical level, within ±9 dB", () => {
  const loud = { ...fakeClip("v1", 10), levels: Array(20).fill(-10) };
  const mid = { ...fakeClip("v2", 10), levels: Array(20).fill(-25) };
  const quiet = { ...fakeClip("v3", 10), levels: Array(20).fill(-45) };
  const a: Analysis = { ...analysis, clips: [loud, mid, quiet], photos: [] };
  const { plan } = buildPlan(a, hypeTheme([{ id: "v1" }, { id: "v2" }, { id: "v3" }]), { durationOverride: 12 });
  const dbOf = (src: string) => videoScenes(plan).filter((s) => s.src === src).map((s) => 20 * Math.log10(s.volume / STYLES.hype.clipVolume));
  for (const d of dbOf("assets/v1.mp4")) assert.ok(Math.abs(d + 9) < 0.2, `loud clip down 9 dB (capped), got ${d}`);
  for (const d of dbOf("assets/v2.mp4")) assert.ok(Math.abs(d) < 0.2, `median clip unchanged, got ${d}`);
  for (const d of dbOf("assets/v3.mp4")) assert.ok(Math.abs(d - 9) < 0.2, `quiet clip up 9 dB (capped), got ${d}`);
  assert.equal(levelGainDb(-70, -25), 0, "near-silence is not boosted");
  assert.ok(Math.abs(shotLevel(mid, 0, 4) + 25) < 1e-6);
});

test("clip sound always fades at scene edges, equal-power over transitions", () => {
  const scene = { volume: 0.5, trimStart: 0, speed: 1 };
  assert.equal(sceneVolume(scene, 0, 90, 30), 0, "starts silent: no click");
  assert.ok(sceneVolume(scene, 1.5, 90, 30) > 0 && sceneVolume(scene, 1.5, 90, 30) < 0.5);
  assert.equal(sceneVolume(scene, 45, 90, 30), 0.5);
  assert.ok(sceneVolume(scene, 90, 90, 30) < 1e-9, "ends silent");
  // Halfway through a 10-frame crossfade the clip sits at −3 dB, so both sides' powers sum to 1.
  const half = sceneVolume(scene, 5, 90, 30, { in: 10 }) / 0.5;
  assert.ok(Math.abs(half * half - 0.5) < 1e-9);
});

test("dark or blurry photos are skipped and the rest ranked by quality", () => {
  assert.ok(photoQuality({ luma: 0.02, detail: 10 }, 10) < PHOTO_MIN, "black frame");
  assert.ok(photoQuality({ luma: 0.4, detail: 2 }, 10) < PHOTO_MIN, "blurred");
  assert.ok(photoQuality({ luma: 0.4, detail: 10 }, 10) > 0.9);
  const photo = (id: string, luma: number, detail: number) => ({ id, kind: "image" as const, name: `${id}.jpg`, folder: "", width: 1600, height: 1200, proxy: `assets/${id}.jpg`, luma, detail });
  const photos = [photo("p4", 0.02, 9), photo("p5", 0.4, 10), photo("p6", 0.4, 1), photo("p7", 0.35, 11)];
  const { plan } = buildPlan({ ...analysis, photos }, hypeTheme(), { durationOverride: 20 });
  const used = plan.scenes.flatMap((s) => (s.kind === "image" ? [s.src] : []));
  assert.ok(used.length > 0);
  assert.ok(!used.includes("assets/p4.jpg") && !used.includes("assets/p6.jpg"), JSON.stringify(used));
});

test("near-duplicate clips are found by middle-frame hash and length", () => {
  const clips = [
    { duration: 10, dhash: "f0f0f0f0f0f0f0f0" },
    { duration: 10.2, dhash: "f0f0f0f0f0f0f0f1" }, // the same clip re-uploaded
    { duration: 30, dhash: "f0f0f0f0f0f0f0f0" }, // same framing, different clip
    { duration: 10, dhash: "0f0f0f0f0f0f0f0f" },
  ];
  assert.deepEqual(duplicateClips(clips), [1]);
});

test("EXIF orientation is read from a JPEG header", () => {
  // SOI, APP1 "Exif\0\0", little-endian TIFF with one IFD entry: Orientation (0x0112) = 6.
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, 0x06, 0x00, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff]);
  const size = app1.length + 2;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff]), app1, Buffer.from([0xff, 0xda, 0, 2])]);
  assert.equal(exifOrientation(jpeg), 6);
  assert.equal(ORIENT_FILTER[6], "transpose=1");
  assert.equal(exifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);
});

test("another version reshuffles the shots, the same way every time, at the same length", () => {
  const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId: "hype", title: "T", outroText: "Bye", shots: [] };
  const key = (p: EditPlan) => p.scenes.map((s) => (s.kind === "video" ? `${s.src}@${s.trimStart}` : s.id)).join(",");
  const first = buildPlan(analysis, theme).plan;
  const v1 = buildPlan(analysis, theme, { variant: 1 }).plan;
  assert.equal(key(v1), key(buildPlan(analysis, theme, { variant: 1 }).plan), "a variant is deterministic");
  const others = [1, 2, 3].map((variant) => key(buildPlan(analysis, theme, { variant }).plan));
  assert.ok(others.some((k) => k !== key(first)), "some variant differs from the first take");
  assert.ok(Math.abs(planDurationInFrames(v1) / v1.fps - 30) < 1);
});

test("match the song: the video runs the song's length", () => {
  const withSong: Analysis = { ...analysis, audio: [{ id: "a0", kind: "audio", name: "song.mp3", duration: 25, proxy: "assets/a0.m4a", bpm: 120, beatOffset: 0, dropAt: 12 }] };
  const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens wide, peaks, closes", occasionFit: "fits a test event", styleId: "hype", title: "T", outroText: "Bye", music: "drive", shots: [] };
  const { plan } = buildPlan(withSong, theme, { durationOverride: 25, fullSong: true });
  const secs = planDurationInFrames(plan) / plan.fps;
  assert.ok(Math.abs(secs - 25) < 1, `got ${secs}s`);
});
