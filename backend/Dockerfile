FROM node:24-alpine

WORKDIR /repo

# Install pnpm globally
RUN npm install -g pnpm@11.0.8

# pnpm 11 aborts asking for interactive confirmation before purging old node_modules;
# there's no TTY in a non-interactive `docker compose up`, so it just hangs/fails.
# CI=true makes it proceed without interaction
ENV CI=true

# Copy workspace manifests for pnpm install
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node frontend/package.json frontend/

RUN apk upgrade --no-cache zlib \
    && pnpm install --frozen-lockfile

RUN chown -R node:node /repo/node_modules

COPY --chown=node:node backend backend

WORKDIR /repo/backend

EXPOSE 8787

USER node

CMD ["pnpm", "run", "start"]
