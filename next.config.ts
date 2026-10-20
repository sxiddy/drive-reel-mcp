import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendering runs in a child process (render/cli.ts); keep these out of the Next bundle.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "ffmpeg-static", "ffprobe-static"],
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
    proxyClientMaxBodySize: "2gb",
  },
};

export default nextConfig;
