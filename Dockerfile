# syntax=docker/dockerfile:1

# Build stages use BUILDPLATFORM (the host's native arch) so Node/esbuild and
# the Go compiler run without QEMU emulation. Cross-compilation is handled in
# the Go build commands via GOOS/GOARCH; the client output is arch-neutral JS.
# Only the final runtime stages switch to TARGETPLATFORM.

##################################################
#                 CLIENT STAGES                  #
##################################################

FROM --platform=$BUILDPLATFORM dhi.io/node:24-dev AS client-base
WORKDIR /usr/local/app
COPY interface/client/package* ./
RUN npm install
COPY interface/client/eslint.config.js interface/client/index.html interface/client/vite.config.js ./
COPY interface/client/public ./public
COPY interface/client/src ./src

FROM client-base AS client-dev
ENV NODE_ENV=development
CMD ["npm", "run", "dev"]

FROM client-base AS client-build
RUN npm run build

##################################################
#                   API STAGES                   #
##################################################

FROM --platform=$BUILDPLATFORM dhi.io/golang:1.26-dev AS api-base
WORKDIR /usr/local/app
COPY interface/api/go.mod interface/api/go.sum ./
RUN go mod download
COPY interface/api/ ./

# Development server with live-reloading via CompileDaemon.
FROM api-base AS server-dev
RUN go install github.com/githubnemo/CompileDaemon@latest
ENV PORT=3030
CMD ["CompileDaemon", "-build=go build -o /tmp/interface .", "-command=/tmp/interface"]

# Build a static API binary cross-compiled for the target platform.
FROM api-base AS api-build
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags "-s -w" -o /interface .

##################################################
#                  SBX STAGES                    #
##################################################

FROM --platform=$BUILDPLATFORM golang:1.25 AS sbx-build
WORKDIR /src
COPY sbx-simulator/go.mod sbx-simulator/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY sbx-simulator/ .
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/sbx ./cmd/sbx

##################################################
#                  FINAL STAGE                   #
##################################################

FROM dhi.io/static:20250419-debian13 AS production
WORKDIR /usr/local/app

COPY --from=api-build /interface ./interface
COPY --from=client-build /usr/local/app/dist ./public

# This is pointing to stage until we validate the analytics.
# The key is known to be a publicly viewable key.
ENV MARLIN_ENDPOINT=https://api.docker.com/events/v1/track
ENV MARLIN_API_KEY=SI7YliKTll5lLPOqPxtJZ49oZ7LgVcqG5sv11bkt

ENV PORT=3030
EXPOSE 3030
USER 1000
CMD ["./interface"]


FROM docker/sandbox-templates:shell-docker AS sandbox
WORKDIR /usr/local/app
# The base image runs as the non-root "agent" user (uid 1000), so switch to root
# to create the labspace directories, hand them to agent (chown, not chmod), then
# switch back for runtime.
USER root
RUN mkdir -p /home/agent/labspace/instructions /home/agent/labspace/project /home/agent/labspace/metadata && \
    chown -R agent:agent /home/agent/labspace /usr/local/app

COPY --from=sbx-build /out/sbx /bin/sbx

COPY --from=api-build /interface ./interface
COPY --from=client-build /usr/local/app/dist ./public
ENV PORT=3030
EXPOSE 3030
USER agent
CMD ["/usr/local/app/interface"]
