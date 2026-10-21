# Website + renderer in one image. Rendering needs Chrome's system libraries, so this
# targets a container host (Hugging Face Docker Space, Railway, Fly.io, a VPS), not
# serverless functions. If CF_TUNNEL_TOKEN is set, a Cloudflare Tunnel serves the site
# on its own domain (itsawrap.cv) as well as on the host's URL.
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
      libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libpango-1.0-0 libcairo2 \
    && curl -fsSL -o /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/download/2026.10.2/cloudflared-linux-$(dpkg --print-architecture).deb \
    && dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face runs containers as uid 1000; the app writes videos under /app/data.
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci && npx remotion browser ensure

COPY --chown=node:node . .
RUN npm run build && mkdir -p data work

ENV NODE_ENV=production PORT=7860
# Videos and their assets live here; mount a volume so they survive deploys.
VOLUME /app/data
EXPOSE 7860
CMD ["sh", "deploy/start.sh"]
