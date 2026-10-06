# syntax = docker/dockerfile:1

# Two stages. The builder installs dependencies — including better-sqlite3, which
# compiles a native binding — then the slim runtime carries only what runs. The
# app is TypeScript executed directly by Node 24 (type stripping), so there's no
# separate build/bundle step. It serves HTTP on 0.0.0.0:$PORT and publishes
# README.md at /readme/; SQLite lives on the /data volume (see fly.toml).

FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The app reads/writes its SQLite database here; Fly mounts the volume at /data.
ENV DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY package.json README.md ./
EXPOSE 8080
CMD ["node", "src/server.ts"]
