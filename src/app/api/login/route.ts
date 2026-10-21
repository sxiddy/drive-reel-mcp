import { GATE_COOKIE, gateToken, same } from "@/src/lib/gate";

export const runtime = "nodejs";

/** Failed attempts per address in the last 10 minutes; after 8, wait. */
const tries = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_TRIES = 8;

/** Checks the site password ({ password }) and sets the sign-in cookie for 30 days. */
export async function POST(req: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return Response.json({ ok: true });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_TRIES) return Response.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });

  let given = "";
  try {
    const body = await req.json();
    given = typeof body.password === "string" ? body.password : "";
  } catch {}
  const ok = same(await gateToken(given), await gateToken(password));
  if (!ok) {
    tries.set(ip, [...recent, now]);
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  tries.delete(ip);
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" || !!req.headers.get("cf-connecting-ip");
  const cookie = `${GATE_COOKIE}=${await gateToken(password)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
}
