# Jam Gym is a static site (no build step), so the image is just nginx plus the files.
FROM nginx:stable-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Only what the browser needs. Tests, tools and docs stay out of the image.
COPY index.html /usr/share/nginx/html/index.html
COPY css /usr/share/nginx/html/css
COPY fonts /usr/share/nginx/html/fonts
COPY src /usr/share/nginx/html/src
COPY samples /usr/share/nginx/html/samples

EXPOSE 80
