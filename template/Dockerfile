# syntax=docker/dockerfile:1

# Build a self-contained image that serves THIS lab. It bases on the prebuilt
# Labspace runtime and swaps in your lab/ directory. The lab is loaded at
# runtime, so this is just a file copy — no app rebuild.
#
#   docker build -t my-lab .
#   docker run --rm -p 8080:80 my-lab      # open http://localhost:8080
#
# Pin RUNTIME_IMAGE to a released version for reproducible builds:
#   docker build --build-arg RUNTIME_IMAGE=dockersamples/labspace-web:1 -t my-lab .

ARG RUNTIME_IMAGE=dockersamples/labspace-web:latest
FROM ${RUNTIME_IMAGE}

# Replace the runtime image's sample lab with this repo's lab.
RUN rm -rf /usr/share/nginx/html/lab
COPY lab/ /usr/share/nginx/html/lab/
