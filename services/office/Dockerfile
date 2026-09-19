FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npm run build

FROM node:22-bookworm-slim
# Agents' bash tool runs inside this container, in /app/data/workspaces/<office>.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3100 DATA_DIR=/app/data WORKSPACES_DIR=/app/data/workspaces
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:3100/api/health || exit 1
CMD ["node", "server/src/index.js"]
