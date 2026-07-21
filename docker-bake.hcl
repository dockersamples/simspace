# Bake definition for building the static Labspace app image.
#
#   docker buildx bake              # multi-platform build (default)
#   docker buildx bake --push       # build and push to the registry
#   docker buildx bake app-local    # single-platform, loaded into local daemon
#
# Common override:
#   IMAGE=docker.io/dockersamples/sbxlab docker buildx bake --push

# Fully-qualified image name (without tag).
variable "IMAGE" {
  default = "michaelirwin244/sbxlab"
}

# Tags applied to the built image.
variable "TAGS" {
  default = ["latest"]
}

# Target platforms for the release build.
variable "PLATFORMS" {
  default = ["linux/amd64", "linux/arm64"]
}

group "default" {
  targets = ["app"]
}

# Multi-platform static-app image. Use --push to publish, since a multi-arch
# manifest cannot be loaded into the local daemon.
target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "production"
  platforms  = PLATFORMS
  tags       = [for t in TAGS : "${IMAGE}:${t}"]
}

# Single-platform build for local development, loaded into the Docker daemon.
target "app-local" {
  inherits  = ["app"]
  platforms = ["local"]
  output    = ["type=docker"]
}
