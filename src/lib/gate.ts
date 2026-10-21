/**
 * Site-wide password (SITE_PASSWORD). Visitors who know it get a cookie holding a hash of it, so changing
 * the password signs everyone out. Without SITE_PASSWORD the site is open (local development).
 * Web Crypto only, so this runs in the proxy as well as in route handlers.
 */
export const GATE_COOKIE = "itsawrap_pass";

export async function gateToken(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`itsawrap-gate:${password}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (both sides are fixed-length hashes or tokens). */
export function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
