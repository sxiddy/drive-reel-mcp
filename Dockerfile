# Website + renderer in one image. Rendering needs Chrome's system libraries, so this
# targets a container host with a persistent disk (Railway, Fly.io, Render, a VPS),
# not serverless functions.
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
      libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx remotion browser ensure

COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3000
# Videos and their assets live here; mount a volume so they survive deploys.
VOLUME /app/data
EXPOSE 3000
CMD ["npm", "start"]
