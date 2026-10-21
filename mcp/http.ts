import crypto from "node:crypto";
import http from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless) for mcp.itsawrap.cv.
 * Every call needs MCP_TOKEN, as `Authorization: Bearer <token>` or as the path `/mcp/<token>`
 * (for clients such as claude.ai connectors that only take a URL).
 */
export function serveHttp(createServer: () => McpServer) {
  const token = process.env.MCP_TOKEN;
  if (!token || token.length < 24) throw new Error("Set MCP_TOKEN (24+ characters) to serve MCP over HTTP.");
  // Remote callers must never reach files on this machine.
  delete process.env.ALLOW_LOCAL_SOURCES;
  const port = Number(process.env.MCP_PORT ?? 3200);

  const same = (a: string, b: string) =>
    crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
  const authorized = (req: http.IncomingMessage, pathname: string) =>
    same(req.headers.authorization ?? "", `Bearer ${token}`) || same(pathname, `/mcp/${token}`);

  http
    .createServer(async (req, res) => {
      const { pathname } = new URL(req.url ?? "/", "http://x");
      if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/plain" }).end("It's a Wrap MCP server. Connect an MCP client to /mcp.\n");
        return;
      }
      if (!(pathname === "/mcp" || pathname.startsWith("/mcp/"))) {
        res.writeHead(404).end();
        return;
      }
      if (!authorized(req, pathname)) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" }).end();
        return;
      }
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("mcp http error", err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    })
    .listen(port, "127.0.0.1", () => console.error(`drive-reel MCP over HTTP on http://127.0.0.1:${port}/mcp`));
}
