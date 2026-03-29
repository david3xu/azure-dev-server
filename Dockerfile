# syntax=docker/dockerfile:1
# Build stage: compile TypeScript
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm run build

# Runtime stage: production image with workspace tools
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      ncurses-bin \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist dist/
EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001
CMD ["node", "dist/server.js"]
