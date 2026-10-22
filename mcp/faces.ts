import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ffmpeg } from "./media";

/**
 * Local face detection: @vladmandic/face-api's bundled TensorFlow.js (pure JS CPU backend, no native
 * build, no network) with its SSD MobileNet v1 face model read from node_modules. Frames are decoded by
 * ffmpeg to raw RGB, so no canvas package is needed. Runs the same on Windows and Linux.
 */

/** One sampled frame (or a photo). n: faces found; area: largest face's share of the frame (0..1); cx/cy: centre of the faces, 0..1. */
export type FaceSample = { t?: number; n: number; area: number; cx: number; cy: number };

type Box = { x: number; y: number; w: number; h: number; score: number };

const require = createRequire(import.meta.url);
/** Long side of the frame fed to the detector. */
const SIZE = 480;
const MIN_SCORE = 0.45;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: Promise<any> | undefined;

function load() {
  api ??= (async () => {
    const pkg = path.dirname(require.resolve("@vladmandic/face-api/package.json"));
    // The ESM build bundles TensorFlow.js; in Node it runs on the CPU backend.
    // Its Node platform shim needs require("util"), which the browser bundle stubs out; hide Node while it
    // loads and register a small platform built on Node's globals instead.
    const versions = process.versions;
    Object.defineProperty(process, "versions", { value: { ...versions, node: undefined }, configurable: true, writable: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let faceapi: any;
    try {
      faceapi = await import(pathToUrl(path.join(pkg, "dist", "face-api.esm.js")));
    } finally {
      Object.defineProperty(process, "versions", { value: versions, configurable: true, writable: true });
    }
    const enc = new TextEncoder();
    faceapi.tf.env().setPlatform("node-lite", {
      fetch: (u: string, i?: RequestInit) => fetch(u, i),
      now: () => performance.now(),
      encode: (s: string) => enc.encode(s),
      decode: (b: Uint8Array, e: string) => new TextDecoder(e).decode(b),
      isTypedArray: (a: unknown) => ArrayBuffer.isView(a) && !(a instanceof DataView),
      setTimeoutCustom: (f: () => void, d: number) => setTimeout(f, d),
    });
    // face-api's own environment (canvas/image classes): only tensors are ever passed in, so stubs do.
    class Stub {}
    faceapi.env.setEnv({
      Canvas: Stub, CanvasRenderingContext2D: Stub, Image: Stub, ImageData: Stub, Video: Stub,
      createCanvasElement: () => ({}), createImageElement: () => ({}), createVideoElement: () => ({}),
      fetch: (u: string, i?: RequestInit) => fetch(u, i),
      readFile: (f: string) => fs.promises.readFile(f),
    });
    await faceapi.tf.setBackend("cpu");
    await faceapi.tf.ready();
    const dir = path.join(pkg, "model");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "ssd_mobilenetv1_model-weights_manifest.json"), "utf8"));
    const bin = fs.readFileSync(path.join(dir, "ssd_mobilenetv1_model.bin"));
    const weights = faceapi.tf.io.decodeWeights(new Uint8Array(bin).buffer, manifest[0].weights);
    faceapi.nets.ssdMobilenetv1.loadFromWeightMap(weights);
    return faceapi;
  })();
  return api;
}

const pathToUrl = (p: string) => new URL(`file:///${p.replace(/\\/g, "/").replace(/^\/+/, "")}`).href;

/** Faces in a raw RGB frame. */
export async function detectFaces(rgb: Uint8Array, width: number, height: number): Promise<Box[]> {
  const faceapi = await load();
  const t = faceapi.tf.tensor3d(rgb, [height, width, 3], "int32");
  try {
    const res = await faceapi.detectAllFaces(t, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_SCORE, maxResults: 40 }));
    return res.map((d: { box: { x: number; y: number; width: number; height: number }; score: number }) => ({
      x: d.box.x / width,
      y: d.box.y / height,
      w: d.box.width / width,
      h: d.box.height / height,
      score: d.score,
    }));
  } finally {
    t.dispose();
  }
}

/** Summary of a frame's faces. The centre is the area-weighted mean of the faces, so a crop keeps the group. */
export function summarize(boxes: Box[], t?: number): FaceSample {
  // Tiny detections in a crowd are real but say nothing about framing; keep them in the count only.
  const n = boxes.length;
  if (!n) return { ...(t !== undefined ? { t } : {}), n: 0, area: 0, cx: 0.5, cy: 0.4 };
  const areas = boxes.map((b) => b.w * b.h);
  const wsum = areas.reduce((a, b) => a + b, 0);
  const cx = boxes.reduce((s, b, i) => s + (b.x + b.w / 2) * areas[i], 0) / wsum;
  const cy = boxes.reduce((s, b, i) => s + (b.y + b.h / 2) * areas[i], 0) / wsum;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { ...(t !== undefined ? { t } : {}), n, area: r(Math.max(...areas)), cx: r(cx), cy: r(cy) };
}

const ROTATE: Record<number, string> = { 0: "", 90: "transpose=1,", 270: "transpose=2," };

/**
 * The sideways check looks at turned frames, where a phone clip's people are small: it gets a larger frame
 * so their faces are big enough to find. Everything else stays at SIZE (detection is the slow part).
 */
const ROTATED_SIZE = 800;

/** One frame of a file (seeked to `at` for videos), scaled to `size` on its long side, optionally rotated. */
async function frameRgb(file: string, at: number | undefined, rotate: 0 | 90 | 270, tmp: string, size = SIZE) {
  const vf = `${ROTATE[rotate]}scale='if(gt(iw,ih),${size},-2)':'if(gt(iw,ih),-2,${size})'`;
  const { stderr } = await ffmpeg([...(at !== undefined ? ["-ss", at.toFixed(2)] : []), "-i", file, "-vf", `${vf},showinfo`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", tmp], 120_000);
  const m = stderr.match(/s:(\d+)x(\d+)/);
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  let w = m ? Number(m[1]) : 0;
  let h = m ? Number(m[2]) : 0;
  if (!w || w * h * 3 !== buf.length) {
    // showinfo missing: infer from the byte count assuming the long side is `size`.
    const px = buf.length / 3;
    const other = Math.round(px / size);
    [w, h] = other <= size ? (other * size === px ? [size, other] : [other, size]) : [size, other];
  }
  return { rgb: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), w, h };
}

export async function facesAt(file: string, tmp: string, at?: number, rotate: 0 | 90 | 270 = 0, size = SIZE): Promise<FaceSample> {
  const f = await frameRgb(file, at, rotate, tmp, size);
  return summarize(await detectFaces(f.rgb, f.w, f.h), at);
}

/** Face samples at `n` evenly spaced moments of a clip. */
export async function clipFaces(file: string, duration: number, tmp: string, n = 5): Promise<FaceSample[]> {
  const out: FaceSample[] = [];
  for (let k = 0; k < n; k++) {
    const t = Math.round(((k + 0.5) * duration * 100) / n) / 100;
    out.push(await facesAt(file, tmp, Math.min(t, Math.max(0, duration - 0.1)), 0));
  }
  return out;
}

/**
 * Sideways-filmed clip (phone held flat, no rotation flag): faces appear only when the frame is turned
 * ±90°. Returns the clockwise rotation that makes it upright, or undefined when it looks upright (or it's
 * unclear). Decided on the same frames as `upright`, needing clearly more faces turned than as filmed.
 */
export async function sidewaysRotation(file: string, duration: number, upright: FaceSample[], tmp: string): Promise<90 | 270 | undefined> {
  const shown = upright.reduce((n, s) => n + s.n, 0);
  if (shown >= 2) return undefined;
  const times = upright.map((s) => s.t ?? duration / 2);
  let best: { rot: 90 | 270; n: number; frames: number } | undefined;
  for (const rot of [90, 270] as const) {
    let n = 0;
    let frames = 0;
    for (const t of times) {
      const s = await facesAt(file, tmp, t, rot, ROTATED_SIZE);
      n += s.n;
      if (s.n) frames++;
    }
    if (!best || n > best.n) best = { rot, n, frames };
  }
  return best && best.frames >= 2 && best.n >= Math.max(2, 2 * shown + 1) ? best.rot : undefined;
}
