# syntax=docker/dockerfile:1

# This repo produces two images from one app:
#
#   production — nginx serving the built static site (the "runtime"). A lab
#                author bases their deploy image on this and swaps in their labs/
#                directory (labs are loaded at runtime, so no rebuild needed).
#   authoring  — native-arch Node with the app source + scripts, for authors to
#                run `npm run dev` (live preview) and `npm run validate-lab`.
#
# For GitHub Pages, skip the image entirely and publish `app/dist`
# (see .github/workflows/deploy.yml), or extract the runtime image's static
# payload (see .github/workflows/deploy-lab.yml).

##################################################
#                  BUILD STAGE                   #
##################################################

# The static output is platform-independent, so build it on the build platform.
FROM --platform=$BUILDPLATFORM dhi.io/node:24-alpine-dev AS build
WORKDIR /usr/local/app
# Manifests first, so `npm ci` caches independently of the source.
#
# EVERY npm workspace under packages/ needs its package.json listed here — add a
# line when you add a package. Miss one and `npm ci` still exits 0, leaving a
# node_modules symlink pointing at a directory that doesn't exist yet; the COPY
# below happens to fill it in, so the image works and the mistake stays hidden
# until something resolves that package earlier.
COPY app/package*.json ./
COPY app/packages/simulator/package.json ./packages/simulator/
COPY app/packages/labspace/package.json ./packages/labspace/
RUN npm ci
COPY app/ ./
RUN npm run build

##################################################
#                  SERVE STAGE                   #
##################################################

FROM dhi.io/nginx:1-alpine AS production
COPY --from=build /usr/local/app/dist /usr/share/nginx/html
EXPOSE 80

##################################################
#                AUTHORING STAGE                 #
##################################################

# Native-arch (no --platform pin) so `npm run dev` / `validate-lab` run on the
# author's machine and in CI. Authors mount only their labs/ directory into this:
#   dev:      -v ./labs:/usr/local/app/public/labs  (served by `npm run dev`)
#   validate: -v ./labs:/labs                        (npm run validate-lab -- /labs)
FROM dhi.io/node:24-alpine-dev AS authoring
WORKDIR /usr/local/app
# Keep in step with the build stage above — one line per workspace package.
COPY app/package*.json ./
COPY app/packages/simulator/package.json ./packages/simulator/
COPY app/packages/labspace/package.json ./packages/labspace/
RUN npm ci
COPY app/ ./
# The workspace packages' `exports` point at compiled dist/ (gitignored). Vite
# aliases them to source (see vite.config.js), but validate-lab runs through a
# standalone esbuild (scripts/run-ts.mjs) with no such alias, so it resolves the
# real exports and needs dist/ to exist. Build the packages before the image is
# used, or `npm run validate-lab` fails with "Could not resolve
# @dockersamples/simspace-simulator".
RUN npm run build:packages
EXPOSE 5173
CMD ["npm", "run", "dev"]
