import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { EditPlan } from "../shared/plan";
import { normalizeLoudness } from "./loudness";
import { serveDirectory } from "./static-server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "remotion", "index.ts");
const CACHE = path.join(ROOT, ".cache", "bundle");

/** Hash of the composition sources, so the webpack bundle is rebuilt only when they change. */
export function sourceHash() {
  const h = crypto.createHash("sha1");
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else h.update(path.relative(ROOT, full)).update(fs.readFileSync(full));
    }
  };
  for (const dir of ["remotion", "shared"]) walk(path.join(ROOT, dir));
  return h.digest("hex").slice(0, 12);
}

/** Old bundles are removed once they have not been touched for a while (another process may still be rendering from one). */
function pruneOldBundles(keep: string) {
  const cutoff = Date.now() - 30 * 60_000;
  for (const name of fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []) {
    const dir = path.join(CACHE, name);
    if (dir === keep) continue;
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Being renamed or deleted by another process: leave it.
    }
  }
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Bundles the composition once per source hash. Safe for several processes at once: each bundles into
 * its own temp dir and renames it into place; whoever loses the race uses the winner's bundle.
 */
export function getBundle(): Promise<string> {
  const hash = sourceHash();
  const out = path.join(CACHE, hash);
  if (fs.existsSync(path.join(out, "index.html"))) {
    // Mark it as in use so other processes don't prune it.
    const now = new Date();
    try {
      fs.utimesSync(out, now, now);
    } catch {
      // Read-only cache: fine.
    }
    return Promise.resolve(out);
  }
  const pending = inFlight.get(hash);
  if (pending) return pending;
  const job = (async () => {
    fs.mkdirSync(CACHE, { recursive: true });
    const tmp = `${out}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    let keepTmp = false;
    try {
      await bundle({ entryPoint: ENTRY, outDir: tmp, onProgress: () => undefined });
      if (sourceHash() !== hash) {
        // Sources changed while bundling: use this bundle for this render only, never cache it under a hash it may not match.
        keepTmp = true;
        return tmp;
      }
      try {
        fs.renameSync(tmp, out);
      } catch (e) {
        // Another process finished first (the target exists), so use theirs.
        if (!fs.existsSync(path.join(out, "index.html"))) throw e;
      }
    } finally {
      if (!keepTmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
    pruneOldBundles(out);
    return out;
  })().finally(() => inFlight.delete(hash));
  inFlight.set(hash, job);
  return job;
}

let activeRenders = 0;

// Ports handed to Remotion by this process that may not be bound yet; never hand out the same one twice at once.
const reserved = new Set<number>();

/**
 * Asks the OS for a free port. Remotion's own port search starts at 3000 and can land on the website's
 * dev server ("not a valid Remotion project"); a fixed port breaks concurrent renders. This avoids both.
 */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
    if (port && !reserved.has(port)) return port;
  }
  throw new Error("Could not find a free port for the renderer");
}

/** Runs a Remotion call on a fresh free port, retrying if another process grabbed it in between. */
async function onFreePort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const port = await freePort();
    reserved.add(port);
    try {
      return await fn(port);
    } catch (e) {
      const busy = e instanceof Error && /port.*(not available|in use)|EADDRINUSE/i.test(e.message);
      if (!busy || attempt >= 3) throw e;
    } finally {
      reserved.delete(port);
    }
  }
}

export type RenderOptions = {
  plan: EditPlan;
  /** Directory that the plan's relative asset paths resolve against. */
  assetDir: string;
  outFile: string;
  posterFile?: string;
  onProgress?: (fraction: number) => void;
  /** Normalise the soundtrack to -14 LUFS / -1.5 dBTP after rendering (default true). */
  normalizeAudio?: boolean;
};

/** Renders a plan to MP4 (and optionally a poster JPEG). Assets are served from a temporary local server. */
export async function renderPlan({ plan, assetDir, outFile, posterFile, onProgress, normalizeAudio = true }: RenderOptions) {
  const serveUrl = await getBundle();
  const server = await serveDirectory(assetDir);
  try {
    const inputProps = { plan: EditPlan.parse({ ...plan, assetBase: server.url }) };
    const composition = await onFreePort((port) => selectComposition({ serveUrl, id: "Reel", inputProps, port }));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    activeRenders++;
    try {
      // Under heavy parallel load Remotion's frame extractor occasionally reports "No frame found" for a
      // frame that exists; a second attempt (fresh port, fresh compositor) gets through.
      for (let attempt = 1; ; attempt++) {
        try {
          await onFreePort((port) =>
            renderMedia({
              serveUrl,
              composition,
              inputProps,
              codec: "h264",
              port,
              outputLocation: outFile,
              crf: 20,
              x264Preset: "veryfast",
              timeoutInMilliseconds: 120_000,
              // Renders running side by side share the CPU instead of each taking half of it.
              concurrency: Math.max(1, Math.floor(os.cpus().length / 2 / activeRenders)),
              // Leave the last few percent for the loudness pass.
              onProgress: ({ progress }) => onProgress?.(progress * 0.97),
            }),
          );
          break;
        } catch (e) {
          const transient = e instanceof Error && /No frame found|Compositor error|Request closed|ERR_CONNECTION_REFUSED|Target closed/i.test(e.message);
          if (!transient || attempt >= 2) throw e;
        }
      }
    } finally {
      activeRenders--;
    }
    if (normalizeAudio) await normalizeLoudness(outFile);
    onProgress?.(1);
    if (posterFile) {
      const introFrames = Math.round(plan.intro.duration * plan.fps);
      await onFreePort((port) =>
        renderStill({
          serveUrl,
          composition,
          inputProps,
          output: posterFile,
          imageFormat: "jpeg",
          port,
          jpegQuality: 85,
          frame: Math.min(composition.durationInFrames - 1, Math.max(0, introFrames - 15)),
        }),
      );
    }
    return { durationInFrames: composition.durationInFrames, width: composition.width, height: composition.height };
  } finally {
    await server.close();
  }
}

/** Renders one frame of a plan to a JPEG; handy for previews and visual checks. Safe to run alongside renderPlan. */
export async function renderPlanStill({ plan, assetDir, frame, output, scale = 1, quality = 90 }: { plan: EditPlan; assetDir: string; frame: number; output: string; scale?: number; quality?: number }) {
  const serveUrl = await getBundle();
  const server = await serveDirectory(assetDir);
  try {
    const inputProps = { plan: EditPlan.parse({ ...plan, assetBase: server.url }) };
    const composition = await onFreePort((port) => selectComposition({ serveUrl, id: "Reel", inputProps, port }));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await onFreePort((port) =>
      renderStill({
        serveUrl,
        composition,
        inputProps,
        output,
        imageFormat: "jpeg",
        jpegQuality: quality,
        scale,
        port,
        frame: Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(frame))),
      }),
    );
  } finally {
    await server.close();
  }
}

/**
 * Half-size JPEG of one frame, for showing proposed themes side by side. Defaults to the moment the
 * intro title is fully revealed (about 70% into the intro), or the first scene's middle when there is no intro.
 */
export async function renderPreviewStill(opts: { plan: EditPlan; assetDir: string; outFile: string; frame?: number }): Promise<void> {
  const { plan } = opts;
  const frame =
    opts.frame ?? (plan.intro.duration > 0 ? Math.round(plan.intro.duration * plan.fps * 0.7) : Math.round((plan.scenes[0]?.duration ?? 1) * plan.fps * 0.5));
  await renderPlanStill({ plan, assetDir: opts.assetDir, frame, output: opts.outFile, scale: 0.5, quality: 80 });
}
