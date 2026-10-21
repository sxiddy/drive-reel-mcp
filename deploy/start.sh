#!/bin/sh
# Starts the site, plus the Cloudflare Tunnel when a token is configured.
set -e
if [ -n "$CF_TUNNEL_TOKEN" ]; then
  cloudflared tunnel --no-autoupdate run --url "http://localhost:$PORT" --token "$CF_TUNNEL_TOKEN" &
fi
exec npx next start -p "$PORT"
