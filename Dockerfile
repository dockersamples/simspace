# syntax=docker/dockerfile:1

# The app is a fully static site (React + an in-browser simulator). This image
# builds it and serves the static assets with nginx. For GitHub Pages, skip the
# image entirely and publish `app/dist` (see .github/workflows/deploy.yml).

##################################################
#                  BUILD STAGE                   #
##################################################

FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /usr/local/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

##################################################
#                  SERVE STAGE                   #
##################################################

FROM nginx:alpine AS production
COPY --from=build /usr/local/app/dist /usr/share/nginx/html
EXPOSE 80
