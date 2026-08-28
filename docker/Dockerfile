FROM oven/bun:1 AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY .npmrc ./
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_COMMIT_SHA
ENV VITE_COMMIT_SHA=$VITE_COMMIT_SHA

RUN bun run build
RUN bun run cache:build

FROM nginx:stable-alpine AS runtime

COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
# Not conf.d: nginx auto-includes conf.d/*.conf into the http block, and this
# is a per-location snippet, not a standalone config.
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
