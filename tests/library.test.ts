import assert from "node:assert/strict";
import { test } from "node:test";
import { pickTrack, trackSegment, type LibraryTrack } from "../mcp/library";

const t = (file: string, styles: LibraryTrack["styles"], extra: Partial<LibraryTrack> = {}): LibraryTrack => ({
  file, title: file, artist: "A", sourceUrl: "", license: "CC BY 4.0", licenseUrl: "", credit: file,
  styles, bpm: 120, beatOffset: 0.5, duration: 180, path: file, ...extra,
});

const LIB = [
  t("hype-drop-a", ["hype"], { bpm: 128, dropAt: 40 }),
  t("hype-drop-b", ["hype", "neon"], { bpm: 124, dropAt: 50 }),
  t("hype-flat", ["hype"], { bpm: 128 }),
  t("elegant", ["elegant"], { bpm: 80 }),
  t("nostalgic", ["nostalgic", "elegant"], { bpm: 95 }),
  t("short-elegant", ["elegant"], { bpm: 80, duration: 30 }),
];

test("pickTrack prefers the style and a drop for hype", () => {
  for (let s = 0; s < 30; s++) {
    const p = pickTrack("hype", "college fest", 45, s, LIB)!;
    assert.ok(p.styles.includes("hype"));
    assert.ok(p.dropAt !== undefined, `seed ${s} picked ${p.file}`);
  }
});

test("pickTrack is deterministic per seed and varies across seeds", () => {
  assert.equal(pickTrack("hype", "party", 30, "x", LIB)!.file, pickTrack("hype", "party", 30, "x", LIB)!.file);
  const seen = new Set(Array.from({ length: 40 }, (_, s) => pickTrack("hype", "party", 30, s, LIB)!.file));
  assert.ok(seen.size >= 2);
});

test("pickTrack avoids tracks too short for the cut", () => {
  for (let s = 0; s < 20; s++) assert.notEqual(pickTrack("elegant", "wedding", 60, s, LIB)!.file, "short-elegant");
});

test("pickTrack returns undefined on an empty library", () => {
  assert.equal(pickTrack("hype", "party", 30, 1, []), undefined);
});

test("trackSegment includes the drop and ends on the bar grid", () => {
  const tr = LIB[0];
  const { start, end } = trackSegment(tr, 30, "hype");
  assert.ok(start <= tr.dropAt! && end > tr.dropAt! + 5, `${start}-${end}`);
  const bar = (4 * 60) / tr.bpm;
  const k = (end - tr.beatOffset) / bar;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-6);
  assert.ok(Math.abs(end - start - 30) <= bar);
});

test("trackSegment fits inside the track and loops short ones", () => {
  const s = trackSegment(LIB[1], 170, "hype");
  assert.ok(s.end <= 180 && s.start >= 0);
  assert.deepEqual(trackSegment(LIB[5], 60), { start: 0, end: 30 });
});
