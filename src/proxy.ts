import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, same } from "./lib/gate";

/** Paths anyone may load: the sign-in page itself and what it needs to render. */
const OPEN = /^\/(login|api\/login)(\/|$)|^\/(_next|favicon|icon|apple-icon)/;

export async function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (OPEN.test(pathname)) return NextResponse.next();

  const want = await gateToken(password);
  if (same(req.cookies.get(GATE_COOKIE)?.value ?? "", want)) return NextResponse.next();
  // The render worker and the MCP server publish with the owner's token instead of a cookie.
  const token = process.env.PUBLISH_TOKEN;
  if (token && same(req.headers.get("authorization") ?? "", `Bearer ${token}`)) return NextResponse.next();

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
    return NextResponse.json({ error: "This site is private. Sign in first." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: "/((?!_next/static|_next/image).*)",
};
