# The company worker as a container: clones the framework repo at build
# time (public), builds the runtime, and runs every company under
# /src/companies on port 3000 (the droplet driver maps 3000 → nginx).
# Persistent state (SQLite, vault rows) lives in /data, a docker volume.
#
# Build args: REPO (git URL), REF (branch/tag). Runtime env comes from
# .env.deploy next to this file (VAULT_KEY, HIVE_API_TOKEN, HIVE_PUBLIC_URL,
# HIVE_UI_URL, model keys). See README.md.
FROM node:22-alpine AS build
RUN apk add --no-cache git python3 make g++
ARG REPO=https://github.com/nishgaba-ai/ai-alpha-hive.git
ARG REF=main
WORKDIR /src
RUN git clone --depth 1 --branch "$REF" "$REPO" . && cd runtime && npm ci --no-audit --no-fund && npm run build

FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /src
COPY --from=build /src/runtime /src/runtime
COPY --from=build /src/templates /src/templates
COPY --from=build /src/docs /src/docs
COPY --from=build /src/companies /src/companies
ENV NODE_ENV=production
ENV HIVE_API_PORT=3000
EXPOSE 3000
# companies are copied to the volume on first start so Settings edits persist across releases
CMD ["sh", "-c", "mkdir -p /data/companies && [ \"$(ls -A /data/companies)\" ] || cp -r /src/companies/. /data/companies/; exec node runtime/dist/src/cli.js run --group /data/companies --port 3000"]
