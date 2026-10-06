# syntax = docker/dockerfile:1

# Two stages. The builder installs dependencies (better-sqlite3 compiles a native
# binding), bundles the TypeScript to plain JavaScript with esbuild, then drops
# dev dependencies. The slim runtime carries only the compiled app plus the
# production node_modules. It serves HTTP on 0.0.0.0:$PORT and publishes
# README.md at /readme/; SQLite lives on the /data volume (see fly.toml).
#
# The app is compiled ahead of time rather than run from .ts directly: Node's
# experimental type-stripping intermittently aborts better-sqlite3 at teardown,
# so production runs the built dist/server.js on the standard module loader.

FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The app reads/writes its SQLite database here; Fly mounts the volume at /data.
ENV DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json README.md ./
EXPOSE 8080
CMD ["node", "dist/server.js"]
