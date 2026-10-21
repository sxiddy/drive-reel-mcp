import fs from "node:fs";
import path from "node:path";
import { isMakeId } from "@/shared/make";
import { makeDir } from "@/src/lib/make";

export const runtime = "nodejs";

/** A theme's preview still (its title card over its footage). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; theme: string }> }) {
  const { id, theme } = await ctx.params;
  if (!isMakeId(id) || !/^t[1-4]$/.test(theme)) return new Response("not found", { status: 404 });
  const file = path.join(makeDir(id), "previews", `${theme}.jpg`);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
