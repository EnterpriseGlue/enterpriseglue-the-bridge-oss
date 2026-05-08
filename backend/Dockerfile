FROM node:24-alpine

WORKDIR /repo

# Install pnpm globally
RUN npm install -g pnpm@9

# Copy workspace manifests for pnpm install
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node frontend/package.json frontend/

RUN apk upgrade --no-cache zlib \
    && pnpm install --frozen-lockfile

COPY --chown=node:node backend backend

WORKDIR /repo/backend

EXPOSE 8787

USER node

CMD ["pnpm", "run", "start"]
