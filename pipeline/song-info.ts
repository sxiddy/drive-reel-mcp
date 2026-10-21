import { detectBeats } from "../mcp/beats";
import { probe } from "../mcp/media";

/** Prints {"duration","bpm","audio"} for an uploaded song (run by /api/make/song in its own process). */
const file = process.argv[2];
const p = await probe(file).catch(() => null);
if (!p || !p.hasAudio || p.duration < 5) {
  console.log(JSON.stringify({ audio: false }));
} else {
  const beats = await detectBeats(file).catch(() => undefined);
  console.log(JSON.stringify({ audio: true, duration: Math.round(p.duration * 10) / 10, bpm: beats ? Math.round(beats.bpm) : undefined }));
}
