FROM node:24-alpine

WORKDIR /repo

# Source builds advertise the in-development host release identity. Published images override
# this from their immutable vX.Y.Z release tag; the workspace runtime contract guards both paths.
ARG ENTERPRISEGLUE_HOST_VERSION=0.16.0
ENV ENTERPRISEGLUE_HOST_VERSION=${ENTERPRISEGLUE_HOST_VERSION}

# package.json is the authority for the pnpm version. The workspace runtime
# contract fails CI if this explicit Docker pin ever drifts from it.
# npm 11.19.0 still bundles brace-expansion 5.0.7, so replace that bundled
# copy with its patched release without changing the workspace package manager.
RUN npm install -g npm@11.19.0 pnpm@11.0.8 brace-expansion@5.0.9 \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && cp -R /usr/local/lib/node_modules/brace-expansion /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && rm -rf /usr/local/lib/node_modules/brace-expansion

# Copy every manifest that affects pnpm's frozen-lockfile resolution.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/plugin-sdk/package.json packages/plugin-sdk/
COPY --chown=node:node packages/plugin-runtime/package.json packages/plugin-runtime/
COPY --chown=node:node packages/backend-host/package.json packages/backend-host/
COPY --chown=node:node packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY --chown=node:node packages/frontend-host/package.json packages/frontend-host/
COPY --chown=node:node frontend/package.json frontend/

RUN apk upgrade --no-cache \
    && CI=true pnpm install --filter webmodeler-backend... --frozen-lockfile

# Keep dependency installation cacheable across different host user IDs.
ARG DEV_UID=1000
ARG DEV_GID=1000
RUN chown -R "${DEV_UID}:${DEV_GID}" /repo/node_modules \
    && mkdir -p /etc/enterpriseglue/config /var/run/secrets/enterpriseglue \
    && chown -R "${DEV_UID}:${DEV_GID}" /etc/enterpriseglue /var/run/secrets/enterpriseglue

# Docker initializes a fresh named node_modules volume from the image. Mark its
# frozen-lockfile install so dev Compose does not reinstall every package at boot.
RUN node -e "const fs=require('fs');const crypto=require('crypto');const a=fs.readFileSync('package.json');const b=fs.readFileSync('pnpm-lock.yaml');process.stdout.write(crypto.createHash('sha256').update(a).update(b).digest('hex'));" > /repo/node_modules/.deps-hash \
    && chown "${DEV_UID}:${DEV_GID}" /repo/node_modules/.deps-hash

COPY --chown=node:node backend backend

# A fresh named git-repository volume copies this directory's ownership from
# the image, while the source tree itself is bind-mounted from the host.
RUN mkdir -p /repo/backend/data/repos \
    && chown -R "${DEV_UID}:${DEV_GID}" /repo/backend/data/repos

WORKDIR /repo/backend

EXPOSE 8787

USER node

CMD ["pnpm", "run", "start"]
