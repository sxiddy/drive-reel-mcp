import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type SourceRef = { kind: "folder" | "file"; id: string } | { kind: "local"; dir: string };

export type RemoteFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  /** Folder path inside the shared folder, e.g. "Day 1/Stage". */
  folder: string;
};

export type MediaKind = "video" | "image" | "audio" | "other";

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|3gp|mts|m2ts|wmv)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|bmp|gif|nef|cr2|cr3|arw|dng|mpo|tiff?)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

export function mediaKind(name: string, mimeType?: string): MediaKind {
  if (mimeType?.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  if (mimeType?.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (mimeType?.startsWith("audio/") || AUDIO_EXT.test(name)) return "audio";
  return "other";
}

/** Local folders are only for development: otherwise a crafted "link" could publish any folder on this machine. */
export const localSourcesAllowed = () => process.env.ALLOW_LOCAL_SOURCES === "1";

/** Accepts folder links, file links, `?id=` links, bare IDs, and (when ALLOW_LOCAL_SOURCES=1) a folder path on disk. */
export function parseSource(input: string): SourceRef {
  const s = input.trim();
  if (!/^https?:/i.test(s) && /[\\/]/.test(s) && fs.existsSync(s) && fs.statSync(s).isDirectory()) {
    if (!localSourcesAllowed()) throw new Error("Local folders are disabled. Share the footage as a Google Drive folder link (or set ALLOW_LOCAL_SOURCES=1 for development).");
    return { kind: "local", dir: path.resolve(s) };
  }
  const folder = s.match(/\/folders\/([\w-]{10,})/);
  if (folder) return { kind: "folder", id: folder[1] };
  const file = s.match(/\/file\/d\/([\w-]{10,})/) ?? s.match(/\/d\/([\w-]{10,})/);
  if (file) return { kind: "file", id: file[1] };
  const q = s.match(/[?&]id=([\w-]{10,})/);
  if (q) return { kind: /folderview|folders/.test(s) ? "folder" : "file", id: q[1] };
  if (/^[\w-]{20,}$/.test(s)) return { kind: "folder", id: s };
  throw new Error(`Not a Google Drive link: ${input}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retries: Drive answers bursts of anonymous requests with 429 or a temporary 403,
 * and the odd 5xx; these usually clear after a short wait.
 */
export async function driveFetch(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let last: Response | Error | undefined;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(800 * 3 ** (i - 1) + Math.random() * 400);
    try {
      const res = await fetch(url, { ...init, headers: { "User-Agent": "Mozilla/5.0", ...init.headers } });
      if (res.status === 429 || res.status >= 500 || (res.status === 403 && i < 2)) {
        last = res;
        await res.body?.cancel();
        continue;
      }
      return res;
    } catch (e) {
      last = e as Error;
    }
  }
  if (last instanceof Response) return last;
  throw new Error(`Could not reach Google Drive: ${last?.message ?? "unknown error"}`);
}

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/**
 * Parses Drive's embedded folder view (works for any folder shared as "Anyone with the link", no API key).
 * Each entry looks like: <div class="flip-entry" id="entry-ID">…<a href=".../file/d/ID/view…">…<div class="flip-entry-title">NAME</div>
 */
export function parseEmbeddedFolderView(html: string): { id: string; name: string; isFolder: boolean }[] {
  const entries: { id: string; name: string; isFolder: boolean }[] = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    entries.push({ id: m[1], name: decodeHtml(m[3].trim()), isFolder: /\/folders\//.test(m[2]) });
  }
  return entries;
}

async function listViaEmbed(folderId: string, prefix: string, depth: number): Promise<RemoteFile[]> {
  const res = await driveFetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`);
  if (!res.ok) throw new Error(`Drive returned ${res.status} for the folder. Is it shared as "Anyone with the link"?`);
  const html = await res.text();
  const entries = parseEmbeddedFolderView(html);
  if (!entries.length && !/flip-entries/.test(html)) {
    throw new Error('Could not read the folder. Make sure sharing is set to "Anyone with the link can view".');
  }
  const out: RemoteFile[] = [];
  for (const e of entries) {
    if (e.isFolder) {
      if (depth > 0) out.push(...(await listViaEmbed(e.id, prefix ? `${prefix}/${e.name}` : e.name, depth - 1)));
    } else out.push({ id: e.id, name: e.name, folder: prefix });
  }
  return out;
}

type ApiFile = { id: string; name: string; mimeType: string; size?: string; shortcutDetails?: { targetId: string; targetMimeType: string } };

/** Shortcuts point at a file or folder elsewhere in Drive; follow them to the real thing. */
const followShortcut = (f: ApiFile): ApiFile =>
  f.shortcutDetails ? { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, size: undefined } : f;

async function listViaApi(folderId: string, key: string, prefix: string, depth: number): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&fields=nextPageToken,files(id,name,mimeType,size,shortcutDetails)&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${key}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await driveFetch(url);
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { nextPageToken?: string; files: ApiFile[] };
    for (const f of j.files.map(followShortcut)) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        if (depth > 0) out.push(...(await listViaApi(f.id, key, prefix ? `${prefix}/${f.name}` : f.name, depth - 1)));
      } else out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : undefined, folder: prefix });
    }
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

async function fileNameViaApi(id: string, key: string) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size,shortcutDetails&supportsAllDrives=true&key=${key}`);
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return followShortcut((await res.json()) as ApiFile);
}

export async function listSource(ref: SourceRef): Promise<RemoteFile[]> {
  const key = process.env.GOOGLE_API_KEY;
  if (ref.kind === "local") {
    const walk = (dir: string, prefix: string): RemoteFile[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
          ? walk(path.join(dir, d.name), prefix ? `${prefix}/${d.name}` : d.name)
          : [{ id: path.join(dir, d.name), name: d.name, size: fs.statSync(path.join(dir, d.name)).size, folder: prefix }],
      );
    return walk(ref.dir, "");
  }
  if (ref.kind === "file") {
    if (key) {
      const f = await fileNameViaApi(ref.id, key);
      return [{ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : undefined, folder: "" }];
    }
    // Name is resolved from the download's Content-Disposition header.
    return [{ id: ref.id, name: "", folder: "" }];
  }
  return key ? listViaApi(ref.id, key, "", 2) : listViaEmbed(ref.id, "", 2);
}

function filenameFrom(res: Response) {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  return cd.match(/filename="?([^";]+)"?/i)?.[1];
}

/**
 * Downloads one Drive file. Large files return a "can't scan for viruses" page first;
 * its form carries the confirm token we resubmit with.
 */
export async function downloadFile(file: RemoteFile, destDir: string, maxBytes: number): Promise<{ path: string; name: string; bytes: number }> {
  fs.mkdirSync(destDir, { recursive: true });
  if (path.isAbsolute(file.id) && fs.existsSync(file.id)) {
    if (!localSourcesAllowed()) throw new Error("Local files are disabled.");
    const dest = path.join(destDir, localName(file, file.name));
    fs.copyFileSync(file.id, dest);
    return { path: dest, name: file.name, bytes: fs.statSync(dest).size };
  }
  if (mediaKind(file.name, file.mimeType) === "image") return downloadPhoto(file, destDir);
  const key = process.env.GOOGLE_API_KEY;
  let res = await driveFetch(
    key
      ? `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true&key=${key}`
      : `https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`,
    { redirect: "follow" },
  );
  if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
    const html = await res.text();
    const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="(\w+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (!fields.id) throw new Error(`Drive would not serve "${file.name || file.id}". It may be private or over the download quota.`);
    res = await driveFetch(`https://drive.usercontent.google.com/download?${new URLSearchParams(fields)}`);
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for "${file.name || file.id}"`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error(`"${file.name}" is ${(length / 1e9).toFixed(1)} GB, over the per-file limit.`);
  const name = file.name || filenameFrom(res) || file.id;
  const dest = path.join(destDir, localName(file, name));
  let bytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) ctl.error(new Error(`"${name}" exceeds the per-file limit.`));
      else ctl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(limiter) as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
  return { path: dest, name, bytes };
}

/**
 * Photos come through Drive's thumbnail endpoint: it returns a JPEG for HEIC and camera RAW files
 * (which ffmpeg can't decode), and it is far smaller than the originals.
 */
async function downloadPhoto(file: RemoteFile, destDir: string) {
  const res = await driveFetch(`https://drive.google.com/thumbnail?id=${file.id}&sz=w2048`);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`Drive returned no preview for "${file.name}" (${res.status})`);
  const dest = path.join(destDir, localName(file, file.name.replace(/\.[^.]+$/, "") + ".jpg"));
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return { path: dest, name: file.name, bytes: buf.byteLength };
}

export const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

/**
 * Download names carry a short hash of the Drive id: two contributors' "IMG_0001.MOV" must not
 * overwrite each other while downloads run in parallel.
 */
export const localName = (file: Pick<RemoteFile, "id">, name: string) =>
  `${crypto.createHash("sha1").update(file.id).digest("hex").slice(0, 8)}-${safeName(name)}`;
