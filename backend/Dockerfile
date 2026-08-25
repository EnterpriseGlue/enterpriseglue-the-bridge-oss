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
    && CI=true pnpm install --filter webmodeler-backend... --frozen-lockfile \
    && chown -R node:node /repo/node_modules \
    && mkdir -p /etc/enterpriseglue/config /var/run/secrets/enterpriseglue \
    && chown -R node:node /etc/enterpriseglue /var/run/secrets/enterpriseglue

COPY --chown=node:node backend backend

WORKDIR /repo/backend

EXPOSE 8787

USER node

CMD ["pnpm", "run", "start"]
