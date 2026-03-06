FROM node:24-alpine

WORKDIR /repo

# Copy workspace manifests for npm ci
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node frontend/package.json frontend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node backend/package.json backend/

RUN npm ci -w frontend --include=dev --no-audit --no-fund

COPY --chown=node:node frontend frontend

WORKDIR /repo/frontend

EXPOSE 5173

USER node

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
