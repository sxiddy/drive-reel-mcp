/**
 * Checks the website's edit auth, asset validation and media-route hardening against a running site.
 * Usage: tsx tests/web-security.ts <videoId> <editKey> [siteUrl]
 * Read-only for the video except for one plan save that writes back the plan it read.
 */
import fs from "node:fs";
import path from "node:path";

const [id, key, site = "http://localhost:3000"] = process.argv.slice(2);
if (!id || !key) {
  console.error("usage: tsx tests/web-security.ts <videoId> <editKey> [siteUrl]");
  process.exit(2);
}
const token = fs.readFileSync(".env", "utf8").match(/^PUBLISH_TOKEN=(.*)$/m)?.[1]?.trim();
const dir = path.join("data", "videos", id);
const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const req = (p: string, init: RequestInit = {}) => fetch(`${site}${p}`, init);
const json = (body: unknown, extra: Record<string, string> = {}) => ({ method: "PUT", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });

// Secrets never leave the server.
check("GET /api/videos has no editKey", !(await (await req("/api/videos")).text()).includes("editKey"));
check("GET /api/videos/[id] has no editKey", !(await (await req(`/api/videos/${id}`)).text()).includes("editKey"));
for (const p of ["meta.json", "META.JSON", "meta.json.", "meta.json%3A%3A%24DATA", "assets%5C..%5Cmeta.json", "assets/..%2Fmeta.json", ".env", "plan.json", "media.json", "renders/v1.plan.json"]) {
  const r = await req(`/media/${id}/${p}`);
  check(`/media/${id}/${p} refused`, r.status === 404 || r.status === 400, String(r.status));
}
check("/media serves real media", (await req(`/media/${id}/${plan.scenes.find((s: { src?: string }) => s.src)?.src ?? "renders/v1.jpg"}`, { headers: { range: "bytes=0-10" } })).status === 206);

// Writes need the edit key.
check("PUT without key → 401", (await req(`/api/videos/${id}`, json(plan))).status === 401);
check("PUT with wrong key → 401", (await req(`/api/videos/${id}`, json(plan, { "x-edit-key": "0".repeat(32) }))).status === 401);
check("PUT ?reset=1 without key → 401", (await req(`/api/videos/${id}?reset=1`, { method: "PUT" })).status === 401);
check("POST render without key → 401", (await req(`/api/videos/${id}/render`, { method: "POST" })).status === 401);
const f = new FormData();
f.append("file", new Blob([fs.readFileSync(path.join(dir, "renders", "v1.jpg"))]), "x.jpg");
check("POST assets without key → 401", (await req(`/api/videos/${id}/assets`, { method: "POST", body: f })).status === 401);
check("auth endpoint rejects a wrong key", (await req(`/api/videos/${id}/auth`, { method: "POST", headers: { "x-edit-key": "nope" } })).status === 401);
check("auth endpoint accepts the key", (await req(`/api/videos/${id}/auth`, { method: "POST", headers: { "x-edit-key": key } })).status === 200);
check("PUT with key → 200", (await req(`/api/videos/${id}`, json(plan, { "x-edit-key": key }))).status === 200);

// Asset paths.
for (const src of ["http://example.com/x.mp3", "file:///etc/passwd", "../meta.json", "meta.json", "C:/Windows/win.ini", "assets/missing.wav"]) {
  const r = await req(`/api/videos/${id}`, json({ ...plan, music: { src, volume: 0.5, bpm: 100 } }, { "x-edit-key": key }));
  check(`PUT music.src=${src} → 400`, r.status === 400, `${r.status} ${(await r.text()).slice(0, 60)}`);
}

// Publish validates the same way and leaves nothing behind.
const before = fs.readdirSync(path.join("data", "videos")).length;
const pub = new FormData();
pub.append("plan", JSON.stringify({ ...plan, scenes: [{ id: "c1", kind: "card", heading: "Hi", duration: 2 }], music: { src: "http://example.com/x.mp3", volume: 0.5, bpm: 100 } }));
pub.append("meta", "{}");
pub.append("video", new Blob([new Uint8Array(16)]), "v.mp4");
pub.append("poster", new Blob([new Uint8Array(16)]), "p.jpg");
const pr = await req("/api/videos", { method: "POST", body: pub, headers: token ? { Authorization: `Bearer ${token}` } : {} });
const prText = await pr.clone().text();
check("publish with remote music.src → 400", pr.status === 400 && prText.includes("example.com"), `${pr.status} ${(await pr.text()).slice(0, 60)}`);
check("rejected publish leaves no folder", fs.readdirSync(path.join("data", "videos")).length === before);

// Uploads: extension and magic bytes must agree.
const up = async (name: string, bytes: Uint8Array) => {
  const part = new Uint8Array(bytes); // copy onto a plain ArrayBuffer for Blob
  const fd = new FormData();
  fd.append("file", new Blob([part]), name);
  return req(`/api/videos/${id}/assets`, { method: "POST", body: fd, headers: { "x-edit-key": key } });
};
check("upload .mp3 that is really a JPEG → 415", (await up("song.mp3", fs.readFileSync(path.join(dir, "renders", "v1.jpg")))).status === 415);
check("upload .exe → 415", (await up("x.exe", new Uint8Array(64))).status === 415);

// Formats, 4K and downloads: anything that queues a render needs the key; inputs are validated.
const post = (p: string, body: unknown, extra: Record<string, string> = {}) => req(p, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
const render = `/api/videos/${id}/render`;
check("POST render {aspect} without key → 401", (await post(render, { aspect: "9:16" })).status === 401);
check("POST render {aspect} with wrong key → 401", (await post(render, { aspect: "1:1" }, { "x-edit-key": "f".repeat(32) })).status === 401);
check("POST render {aspect, from} without key → 401", (await post(render, { aspect: "9:16", from: 1 })).status === 401);
check("POST render 4K {version, scale: 2} without key → 401", (await post(render, { version: 1, scale: 2 })).status === 401);
check("POST render 4K with wrong key → 401", (await post(render, { version: 1, scale: 2 }, { "x-edit-key": "0".repeat(32) })).status === 401);
for (const bad of [{ aspect: "4:3" }, { version: 1, scale: 3 }, { version: 1 }, { scale: 2 }, { aspect: "9:16", from: "../1" }, { aspect: "9:16", extra: 1 }]) {
  const r = await post(render, bad, { "x-edit-key": key });
  check(`POST render ${JSON.stringify(bad)} with key → 400`, r.status === 400, String(r.status));
}
check("POST render from a missing version → 404", (await post(render, { aspect: "9:16", from: 9999 }, { "x-edit-key": key })).status === 404);
check("POST render 4K of a missing version → 404", (await post(render, { version: 9999, scale: 2 }, { "x-edit-key": key })).status === 404);
check("GET render exposes no pid or key", !/"pid"|editKey/.test(await (await req(render)).text()));

const dl = `/api/videos/${id}/download`;
check("download with a bad quality → 400", (await post(dl, { v: 1, quality: "8k" })).status === 400);
check("download with a path for v → 400", (await post(dl, { v: "../meta.json", quality: "720p" })).status === 400);
check("download of a missing version → 404", (await post(dl, { v: 9999, quality: "720p" })).status === 404);
const d720 = await post(dl, { v: 1, quality: "720p" });
const d720b = d720.status === 200 ? ((await d720.json()) as { url: string }) : null;
check("720p download is prepared and points into renders/", !!d720b && d720b.url.startsWith(`/media/${id}/renders/v1-720p.mp4?download=`), `${d720.status} ${d720b?.url ?? ""}`);
if (d720b) check("720p file is served with ranges", (await req(d720b.url.split("?")[0], { headers: { range: "bytes=0-10" } })).status === 206);
const d4k = await post(dl, { v: 1, quality: "4k" });
check("4K download is the 4K file, or 404 when none exists", d4k.status === 404 || (d4k.status === 200 && ((await d4k.json()) as { url: string }).url.includes("/renders/v1-4k.mp4")), String(d4k.status));
for (const p of ["renders/.v1-720p.mp4.123.part", "renders/v1-720p.mp4.part", "renders/x.mp4", "renders/v1.mp4.tmp", "renders/sub/v1.mp4", "renders/V1-4K.MP4", "renders/v1-og.jpg.", "renders/%2e%2e/meta.json"]) {
  const r = await req(`/media/${id}/${p}`);
  check(`/media/${id}/${p} refused`, r.status === 404 || r.status === 400, String(r.status));
}

// Compare page and the share preview.
const cmp = await req(`/v/${id}/compare`);
check("compare page renders without the key", cmp.status === 200 && !(await cmp.text()).includes(key));
const og = await (await req(`/v/${id}`, { headers: { "user-agent": "facebookexternalhit/1.1" } })).text();
check("og:image is a 1200x630 card", /og:image" content="[^"]+-og\.jpg"/.test(og) && og.includes('og:image:width" content="1200"') && og.includes('og:image:height" content="630"'));
check("og:video and a large twitter card are present", og.includes('property="og:video"') && og.includes('twitter:card" content="summary_large_image"'));
check("watch page never contains the key", !og.includes(key));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
