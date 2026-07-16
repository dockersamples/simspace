# Bake definition for building the SBX Lab sandbox template image.
#
#   docker buildx bake              # multi-platform build (default)
#   docker buildx bake --push       # build and push to the registry
#   docker buildx bake sandbox-local  # single-platform, loaded into local daemon
#
# Common overrides via environment variables:
#   VERSION=v1.2.0 IMAGE=docker.io/dockersamples/sbx-template docker buildx bake --push

# Version stamped into the sbx binary (main.version). Falls back to "dev"
# to match the Makefile behaviour outside a tagged checkout.
variable "VERSION" {
  default = "dev"
}

# Fully-qualified image name (without tag).
variable "IMAGE" {
  default = "michaelirwin244/sbx-lab-template"
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
  targets = ["sandbox"]
}

# Multi-platform sandbox template image. Use --push to publish, since a
# multi-arch manifest cannot be loaded into the local daemon.
target "sandbox" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "sandbox"
  platforms  = PLATFORMS
  args = {
    VERSION = VERSION
  }
  tags = [for t in TAGS : "${IMAGE}:${t}"]
}

# Single-platform build for local development, loaded into the Docker daemon.
target "sandbox-local" {
  inherits  = ["sandbox"]
  platforms = ["local"]
  output    = ["type=docker"]
}
