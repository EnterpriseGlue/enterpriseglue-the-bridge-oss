# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies
WORKDIR /repo
RUN npm install -g pnpm@11.0.8
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches patches
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugin-runtime/package.json packages/plugin-runtime/
COPY packages/backend-host/package.json packages/backend-host/
COPY packages/enterprise-plugin-api/package.json packages/enterprise-plugin-api/
COPY packages/frontend-host/package.json packages/frontend-host/
COPY frontend/package.json frontend/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile --filter webmodeler-backend...

FROM ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646

USER root
RUN apk add --no-cache --upgrade \
      'glibc-2.44>=2.44-r8' \
      'glibc-2.44-dev>=2.44-r8' \
      'glibc-2.44-locale-posix>=2.44-r8' \
      'ld-linux-2.44>=2.44-r8' \
      libcurl-openssl4 \
      wget \
      'libcrypt1-2.44>=2.44-r8'

# The pinned predecessor retains a build-only tool with vulnerable Undici.
# Bootstrap executes Node scripts but never compiles native addons at runtime.
RUN apk del --no-network node-gyp && ! apk info -e node-gyp

# Keep the exact predecessor's compiled entities/migrations and schema-plan
# checks. Refresh dependencies only, with the same reviewed production lock as
# the application. Remove old stores before copying; an overlay would retain
# vulnerable, unused versions in the final filesystem. PostgreSQL bootstrap
# and immutable migration/schema-plan checks must pass before publication.
RUN rm -rf /app/dist/node_modules /app/dist/backend/node_modules \
    /app/dist/packages/backend-host/node_modules /app/dist/packages/shared/node_modules \
    /app/dist/packages/plugin-sdk/node_modules /app/dist/packages/plugin-runtime/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/node_modules /app/dist/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/backend/node_modules /app/dist/backend/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/packages/backend-host/node_modules /app/dist/packages/backend-host/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/packages/shared/node_modules /app/dist/packages/shared/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/packages/plugin-sdk/node_modules /app/dist/packages/plugin-sdk/node_modules
COPY --from=dependencies --chown=65532:65532 /repo/packages/plugin-runtime/node_modules /app/dist/packages/plugin-runtime/node_modules

COPY --chown=65532:65532 scripts/managed-shard-bootstrap.mjs /opt/enterpriseglue-bootstrap/managed-shard-bootstrap.mjs
COPY --chown=65532:65532 scripts/managed-shard-bootstrap-contract.mjs /opt/enterpriseglue-bootstrap/managed-shard-bootstrap-contract.mjs
COPY --chown=65532:65532 infra/database/managed-shard-bootstrap-manifest.json /opt/enterpriseglue-bootstrap/managed-shard-bootstrap-manifest.json
COPY --chown=65532:65532 infra/docker/managed-shard-bootstrap/receipt.keep /var/run/enterpriseglue-bootstrap/.keep

ENV EG_MANAGED_SHARD_PREDECESSOR_REVISION=785b5ab890aba315f6c3944ace0edcc3ff99d20f \
    EG_MANAGED_SHARD_PREDECESSOR_DIGEST=sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646 \
    EG_MANAGED_SHARD_BOOTSTRAP_MANIFEST=/opt/enterpriseglue-bootstrap/managed-shard-bootstrap-manifest.json

LABEL org.opencontainers.image.base.name="ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend" \
      org.opencontainers.image.base.digest="sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646" \
      io.enterpriseglue.managed-shard-bootstrap="postgres-v0.24.2-exact-0130/v1"

USER 65532
ENTRYPOINT ["/usr/bin/node"]
CMD ["/opt/enterpriseglue-bootstrap/managed-shard-bootstrap.mjs"]
