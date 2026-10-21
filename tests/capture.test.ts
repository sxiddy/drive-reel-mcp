import assert from "node:assert/strict";
import { test } from "node:test";
import { captureClock, clockLabel, dateRangeLabel, exifDateToIso, exifTakenAt, timeChips, timeFromName, timeFromTags, timeOrder } from "../mcp/capture";

test("capture time is read from common phone file names", () => {
  assert.equal(timeFromName("PXL_20260919_062022430.mp4"), "2026-09-19T06:20:22Z");
  assert.equal(timeFromName("PXL_20260918_134829562.TS-002.jpg"), "2026-09-18T13:48:29Z");
  assert.equal(timeFromName("VID_20260919_010400816.mp4"), "2026-09-19T01:04:00");
  assert.equal(timeFromName("VID20260918164309.mp4"), "2026-09-18T16:43:09");
  assert.equal(timeFromName("IMG_20260918_221005.jpg"), "2026-09-18T22:10:05");
  assert.equal(timeFromName("20260919_004917.mp4"), "2026-09-19T00:49:17");
  assert.equal(timeFromName("WhatsApp Image 2026-09-18 at 22.10.05.jpeg"), "2026-09-18T22:10:05");
  assert.equal(timeFromName("19-09-202610:54:39AM_6_ByGPSMapCamera.mp4"), "2026-09-19T10:54:39");
  assert.equal(timeFromName("19-09-202612:05:00AM.mp4"), "2026-09-19T00:05:00");
  assert.equal(timeFromName("18-09-202611:30:00PM.jpg"), "2026-09-18T23:30:00");
  for (const n of ["IMG_2688.MOV", "Snapchat-319356816.mp4", "814133db-0291-49f2-9763-8d455b3eeecb.mp4", "6BB52018-E6A4-4DE6-AB38-289A0F541FEB.mp4", "20261345_250000.jpg"]) {
    assert.equal(timeFromName(n), undefined, n);
  }
});

test("capture time is read from container tags and EXIF", () => {
  assert.equal(timeFromTags({ "com.apple.quicktime.creationdate": "2026-09-19T19:40:22+0530", creation_time: "2026-09-19T14:10:22.000000Z" }), "2026-09-19T19:40:22+05:30");
  assert.equal(timeFromTags({ creation_time: "2026-09-19T14:10:22.000000Z" }), "2026-09-19T14:10:22Z");
  assert.equal(timeFromTags({ creation_time: "1970-01-01T00:00:00.000000Z" }), undefined);
  assert.equal(exifDateToIso("2026:09:18 21:49:38", "+05:30"), "2026-09-18T21:49:38+05:30");
  assert.equal(exifDateToIso("0000:00:00 00:00:00"), undefined);
  // Minimal little-endian TIFF: IFD0 → ExifIFD with DateTimeOriginal.
  const dt = Buffer.from("2026:09:18 21:49:38\0", "latin1");
  const tiff = Buffer.alloc(8 + 18 + 18 + dt.length);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(dt.length, 32);
  tiff.writeUInt32LE(44, 36);
  dt.copy(tiff, 44);
  const file = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]), Buffer.from("Exif\0\0", "latin1"), tiff]);
  assert.equal(exifTakenAt(file), "2026-09-18T21:49:38");
});

test("UTC and wall-clock times land on one local clock", () => {
  // An iPhone clip gives +05:30; a Pixel's UTC name moves to IST with it.
  const c = captureClock(["2026-09-19T19:40:22+05:30", "2026-09-18T13:48:29Z", "2026-09-18T22:10:05", undefined]);
  assert.equal(clockLabel(c[0]!), "7:40 PM");
  assert.equal(clockLabel(c[1]!), "7:18 PM");
  assert.equal(clockLabel(c[2]!), "10:10 PM");
  assert.equal(c[3], undefined);
  // No explicit offset: the one that packs UTC items next to wall-clock ones (IST here).
  const d = captureClock(["2026-09-18T22:00:00", "2026-09-19T02:00:00", "2026-09-18T16:30:00Z", "2026-09-18T20:30:00Z"], 0);
  assert.equal(clockLabel(d[2]!), "10:00 PM");
  // An unset camera clock (far from everything else) is ignored.
  const e = captureClock(["2026-09-18T22:00:00", "2026-09-19T02:00:00", "2025-01-01T11:27:15"], 0);
  assert.equal(e[2], undefined);
});

test("story follows capture order only when most items have a time", () => {
  assert.deepEqual(timeOrder([30, 10, undefined, 20, 40]), [1, 2, 3, 0, 4]);
  assert.equal(timeOrder([30, undefined, undefined, 20, undefined]), null);
  assert.equal(timeOrder([]), null);
});

test("time chips: only over a long span, spaced out, when the clock moved on", () => {
  const h = 3600_000;
  const base = Date.UTC(2026, 8, 18, 22, 49);
  const shots = [
    { at: 0, ms: base },
    { at: 1, ms: base + 0.2 * h },
    { at: 2.5, ms: base + 1.2 * h },
    { at: 5, ms: base + 1.3 * h },
    { at: 9, ms: base + 1.4 * h },
    { at: 10, ms: base + 3.5 * h },
    { at: 15, ms: undefined },
  ];
  const chips = timeChips(shots);
  assert.deepEqual(chips, ["10:49 PM", undefined, undefined, "12:07 AM", undefined, "2:19 AM", undefined]);
  const shown = chips.map((c, i) => (c ? shots[i].at : -1)).filter((x) => x >= 0);
  for (let i = 1; i < shown.length; i++) assert.ok(shown[i] - shown[i - 1] >= 4);
  assert.deepEqual(timeChips([{ at: 0, ms: base }, { at: 5, ms: base + 2 * h }]), [undefined, undefined]);
});

test("end card date line is derived from the capture range", () => {
  const d = (y: number, m: number, day: number, h = 12) => Date.UTC(y, m - 1, day, h);
  assert.equal(dateRangeLabel([d(2026, 9, 18, 16), d(2026, 9, 19, 19)]), "18–19 September 2026");
  assert.equal(dateRangeLabel([d(2026, 9, 18), undefined]), "18 September 2026");
  assert.equal(dateRangeLabel([d(2026, 9, 30), d(2026, 10, 1)]), "30 September – 1 October 2026");
  assert.equal(dateRangeLabel([d(2026, 12, 31), d(2027, 1, 1)]), "31 December 2026 – 1 January 2027");
  assert.equal(dateRangeLabel([d(2026, 1, 1), d(2026, 3, 1)]), undefined);
  assert.equal(dateRangeLabel([]), undefined);
});

// ----- Music library, drop alignment, uploads ------------------------------------------------------------
import { buildPlan, cutTimes, type Theme } from "../mcp/planner";
import { timelineSegments, transitionFrames } from "../shared/plan";
import { sniffAudio } from "../shared/make";
import type { Analysis, ClipInfo } from "../mcp/analyze";
import type { LibraryTrack } from "../mcp/library";

const clipOf = (id: string, duration: number): ClipInfo => {
  const n = Math.ceil(duration / 0.5);
  return {
    id, kind: "video", name: `${id}.mp4`, folder: "", duration, width: 1920, height: 1080, orientation: "landscape", hasAudio: false, proxy: `assets/${id}.mp4`, sheet: "", sheetTimes: [],
    energy: Array.from({ length: n }, (_, i) => ((i * 7) % 10) / 10), motion: Array.from({ length: n }, (_, i) => ((i * 3) % 7) / 7), quality: Array(n).fill(1), cuts: [], highlights: [], audioLevel: "silent",
  };
};
const track: LibraryTrack = { file: "t.mp3", title: "T", artist: "A", sourceUrl: "", license: "CC BY 4.0", licenseUrl: "", credit: "T by A (CC BY 4.0)", styles: ["hype"], bpm: 128, beatOffset: 0.12, duration: 150, dropAt: 0.12 + 64 * (60 / 128), path: "/lib/t.mp3" };

test("library track: credit and cut file in the plan, and its drop lands on the cut into the peak burst", () => {
  const a: Analysis = { projectId: "p", source: "x", occasion: "Hackathon", targetDuration: 40, suggestedAspect: "16:9", clips: Array.from({ length: 12 }, (_, i) => clipOf(`v${i + 1}`, 20)), photos: [], audio: [], skipped: [], totals: { footageSeconds: 240, files: 12 }, createdAt: "" };
  const theme: Theme = { id: "t1", name: "T", pitch: "a test pitch", story: "opens, peaks, closes", occasionFit: "fits a test event", styleId: "hype", title: "T", outroText: "Bye", shots: [{ id: "v1" }, { id: "v5" }, { id: "v9" }] };
  const { plan, musicNeeded } = buildPlan(a, theme, { library: [track] });
  assert.equal(plan.music!.credit, track.credit);
  assert.equal(plan.music!.bpm, 128);
  assert.ok(musicNeeded?.kind === "library");
  const start = musicNeeded.kind === "library" ? musicNeeded.start : 0;
  const cuts = cutTimes(plan, timelineSegments(plan), (x, y) => transitionFrames(plan, x, y));
  const dropInVideo = track.dropAt! - start;
  const k = cuts.findIndex((c) => Math.abs(c - dropInVideo) <= 1.01 / 30);
  assert.ok(k >= 0, `a cut sits on the drop at ${dropInVideo.toFixed(2)}s`);
  // Burst: the shots starting at the drop are half a beat long.
  const half = 60 / 128 / 2;
  const after = plan.scenes.slice(k + (plan.intro.duration > 0 ? 0 : 1), k + 3);
  assert.ok(after.length >= 2 && after.every((s) => s.duration < half * 2 + 0.25), `burst after the drop: ${after.map((s) => s.duration)}`);
  // Every cut before the outro is on the half-beat grid of the cut file.
  for (const c of cuts.slice(0, -1)) assert.ok(Math.abs(c / half - Math.round(c / half)) * half <= 1.01 / 30, `cut at ${c}`);
});

test("uploaded songs are recognised by their first bytes", () => {
  const b = (s: string, extra: number[] = []) => new Uint8Array([...Buffer.from(s, "latin1"), ...extra, ...Array(16).fill(0)]);
  assert.equal(sniffAudio(b("ID3\x04")), "mp3");
  assert.equal(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...Array(16).fill(0)])), "mp3");
  assert.equal(sniffAudio(b("RIFF\0\0\0\0WAVE")), "wav");
  assert.equal(sniffAudio(b("OggS")), "ogg");
  assert.equal(sniffAudio(b("\0\0\0\x20ftypM4A ")), "m4a");
  assert.equal(sniffAudio(new Uint8Array([0xff, 0xf1, 0x50, 0x80, ...Array(16).fill(0)])), "aac");
  assert.equal(sniffAudio(b("<html><body>")), null);
  assert.equal(sniffAudio(b("MZ\x90\0")), null);
});
