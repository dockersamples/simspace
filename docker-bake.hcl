# Bake definition for the Labspace images.
#
#   docker buildx bake                    # build both images, multi-platform
#   docker buildx bake --push             # build and push to the registry
#   docker buildx bake app-local          # runtime image, single-arch, local daemon
#   docker buildx bake authoring-local    # authoring image, single-arch, local daemon
#
# Release both images together under the same tags so a lab pinned to a version
# gets a matching runtime + authoring pair:
#   TAGS=1.0.0,1,latest docker buildx bake --push
#
# Common override (publish to the public org):
#   IMAGE=docker.io/dockersamples/simspace \
#   AUTHORING_IMAGE=docker.io/dockersamples/simspace-authoring \
#   docker buildx bake --push

# Fully-qualified image names (without tag).
variable "IMAGE" {
  default = "dockersamples/simspace"
}

variable "AUTHORING_IMAGE" {
  default = "dockersamples/simspace-authoring"
}

# Tags applied to the built images. The explicit list type lets bake coerce a
# comma-separated override from the environment (TAGS=1.0.0,1,latest) into a
# list; without it HCL infers a tuple from the default and rejects the string.
variable "TAGS" {
  type    = list(string)
  default = ["latest"]
}

# Target platforms for the release build. Typed as a list for the same reason,
# so PLATFORMS=linux/amd64,linux/arm64 can be overridden from the environment.
variable "PLATFORMS" {
  type    = list(string)
  default = ["linux/amd64", "linux/arm64"]
}

# Build both images by default so releases stay in lock-step.
group "default" {
  targets = ["app", "authoring"]
}

# Multi-platform static-app (runtime) image. Use --push to publish, since a
# multi-arch manifest cannot be loaded into the local daemon.
target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "production"
  platforms  = PLATFORMS
  tags       = [for t in TAGS : "${IMAGE}:${t}"]
}

# Single-platform runtime build for local development, loaded into the daemon.
target "app-local" {
  inherits  = ["app"]
  platforms = ["local"]
  output    = ["type=docker"]
}

# Multi-platform authoring image (Node + app source + validate-lab).
target "authoring" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "authoring"
  platforms  = PLATFORMS
  tags       = [for t in TAGS : "${AUTHORING_IMAGE}:${t}"]
}

# Single-platform authoring build for local use, loaded into the daemon.
target "authoring-local" {
  inherits  = ["authoring"]
  platforms = ["local"]
  output    = ["type=docker"]
}
