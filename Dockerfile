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
# The simulator engine + terminal live in an npm workspace under packages/, so
# its manifest has to be present for `npm ci` to resolve the workspace link.
COPY app/package*.json ./
COPY app/packages/simulator/package.json ./packages/simulator/
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
COPY app/package*.json ./
COPY app/packages/simulator/package.json ./packages/simulator/
RUN npm ci
COPY app/ ./
EXPOSE 5173
CMD ["npm", "run", "dev"]
