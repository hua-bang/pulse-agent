# Build context: repository root.
#   docker build -f apps/remote-server/deploy/docker/remote-server.Dockerfile .
# Usually built through compose.yml in this directory.

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
# Install only remote-server and its workspace dependencies (no Canvas/Electron).
RUN pnpm install --frozen-lockfile --filter @pulse-coder/remote-server...
# `prebuild` builds engine, acp and plugin-kit first.
RUN pnpm --filter @pulse-coder/remote-server build
# Self-contained production tree: package.json + prod node_modules.
RUN pnpm --filter @pulse-coder/remote-server deploy --prod --legacy /out \
  && rm -rf /out/dist && cp -r apps/remote-server/dist /out/dist \
  && cp -r apps/remote-server/.pulse-coder /out/.pulse-coder \
  && mv /out/.pulse-coder/config.json /out/model-config.default.json

FROM node:22-bookworm-slim
# Tools that agent runs expect: git (worktrees), rg (grep tool), curl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Optional global CLIs, for example ACP agents:
#   NPM_GLOBALS="@zed-industries/claude-agent-acp @zed-industries/codex-acp"
ARG NPM_GLOBALS=""
RUN if [ -n "$NPM_GLOBALS" ]; then npm install -g $NPM_GLOBALS && npm cache clean --force; fi

# Application code stays root-owned, so the agent cannot rewrite the server.
COPY --from=build /out /app
WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  FEISHU_EVENT_SOURCE=long_connection

# Unprivileged runtime user. All writable state lives in /home/node
# (~/.pulse-coder/* sessions, memory, worktrees, devtools).
USER node
# Model config must be writable (`/model` writes it), so it lives in the home
# volume. A new volume is seeded with the repository defaults from the image.
ENV PULSE_CODER_MODEL_CONFIG=/home/node/.pulse-coder/config.json
RUN mkdir -p /home/node/.pulse-coder \
  && cp /app/model-config.default.json /home/node/.pulse-coder/config.json
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/index.cjs"]
