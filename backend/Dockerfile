FROM node:20-alpine

WORKDIR /repo

# Copy workspace manifests for npm ci
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node frontend/package.json frontend/

RUN npm ci -w backend -w packages/shared -w packages/backend-host \
    --include=dev --no-audit --no-fund

COPY --chown=node:node backend backend

WORKDIR /repo/backend

EXPOSE 8787

USER node

CMD ["npm", "run", "start"]
