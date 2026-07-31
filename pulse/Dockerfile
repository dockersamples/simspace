# Development stage: full toolchain + dev deps + source, for `docker compose`
# (the root compose.yaml targets this and mounts src/ over it). Kept first so
# `docker build` without a target still produces the production runtime below.
FROM dhi.io/node:24-alpine-dev AS dev
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 8888
CMD ["npm", "run", "dev"]

# Build stage: install deps (incl. native better-sqlite3) and bundle the service.
FROM dhi.io/node:24-alpine-dev AS build
WORKDIR /app
# Toolchain for compiling the better-sqlite3 native addon.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage: just Node + the bundle + production node_modules.
FROM dhi.io/node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/data/pulse.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/data"]
EXPOSE 8888
CMD ["node", "dist/server.cjs"]
