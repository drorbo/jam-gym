# Jam Gym: one small Node process serves the static site and the tracks API. No npm packages, no build step.
# The database uses Node's built-in SQLite, so the Node version matters (22.13 or newer).
FROM node:24-alpine

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
