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

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
