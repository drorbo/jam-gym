# Jam Gym: one small Node process serves the static site and the tracks API. No npm packages, no build step.
# The database uses Node's built-in SQLite, so the Node version matters (22.13 or newer).
#
# Pinned by digest (the multi-arch index, so this still resolves correctly on an arm64 dev machine), not just the
# "24-alpine" tag: a tag can be moved to point at a different image later, silently changing what gets built; a
# digest cannot. To move to a newer 24-alpine build on purpose, look up the new digest (crane, `docker buildx
# imagetools inspect node:24-alpine`, or the tag's page on hub.docker.com) and replace it here.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app

# Only what runs. Tests, tools and docs stay out of the image.
COPY package.json ./
COPY server ./server
COPY index.html ./index.html
COPY css ./css
COPY fonts ./fonts
COPY src ./src
COPY samples ./samples

# /data holds the database and its backups. The compose file mounts a named volume there, so it survives rebuilds.
# The `node` user (uid 1000) owns it, so the process never runs as root.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 8080
CMD ["node", "server/index.js"]
