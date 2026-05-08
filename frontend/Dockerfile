FROM node:24-alpine

WORKDIR /repo

# Install pnpm globally
RUN npm install -g pnpm@11.0.8

# Copy workspace manifests for pnpm install
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node frontend/package.json frontend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node backend/package.json backend/

RUN apk upgrade --no-cache zlib \
    && pnpm install --frozen-lockfile

COPY --chown=node:node frontend frontend

WORKDIR /repo/frontend

EXPOSE 5173

USER node

CMD ["pnpm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
