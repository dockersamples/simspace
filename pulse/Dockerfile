# Development stage: full toolchain + dev deps + source, for `docker compose`
# (the root compose.yaml targets this and mounts src/ over it). Kept first so
# `docker build` without a target still produces the production runtime below.
FROM dhi.io/node:24-alpine-dev AS dev
WORKDIR /app
# No apk toolchain here: storage is Node's built-in `node:sqlite`, so there is
# no native addon to compile. Everything installed below is dev-only tooling.
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 8888
CMD ["npm", "run", "dev"]

# Build stage: install the (dev-only) build tooling and bundle the service.
#
# Pinned to $BUILDPLATFORM: esbuild emits plain JavaScript and `node:sqlite` is
# built into Node, so dist/ has nothing platform-specific in it. A multi-arch
# bake therefore bundles once on the native builder and reuses the result for
# every target, instead of re-running npm + esbuild under QEMU per platform.
FROM --platform=$BUILDPLATFORM dhi.io/node:24-alpine-dev AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Runtime stage: just Node + the bundle. pulse has no production dependencies —
# esbuild inlines everything and `node:sqlite` is built in — so there is no
# node_modules to carry over. This stage is the only per-target-platform work,
# and it is pure COPY/ENV, so building for a foreign arch needs no emulation.
FROM dhi.io/node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/data/pulse.db
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/data"]
EXPOSE 8888
CMD ["node", "dist/server.cjs"]
