# syntax=docker/dockerfile:1.7
FROM node:24.10.0-alpine3.22 AS build
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/plugin-runtime/package.json packages/plugin-runtime/package.json
COPY packages/plugin-reference/package.json packages/plugin-reference/package.json

RUN --mount=type=cache,id=enterpriseglue-pnpm,target=/root/.local/share/pnpm/store \
  corepack enable \
  && corepack prepare pnpm@11.0.8 --activate \
  && pnpm install --frozen-lockfile \
      --filter @enterpriseglue/plugin-reference... \
      --ignore-scripts

COPY packages/plugin-sdk packages/plugin-sdk
COPY packages/plugin-runtime packages/plugin-runtime
COPY packages/plugin-reference packages/plugin-reference

RUN pnpm --filter @enterpriseglue/plugin-sdk build \
  && pnpm --filter @enterpriseglue/plugin-runtime build \
  && pnpm --filter @enterpriseglue/plugin-reference build \
  && mkdir -p \
      /output/dist \
      /output/node_modules/@enterpriseglue/plugin-runtime \
      /output/node_modules/@enterpriseglue/plugin-sdk \
  && cp packages/plugin-reference/package.json /output/package.json \
  && cp -R packages/plugin-reference/dist/. /output/dist/ \
  && cp packages/plugin-runtime/package.json \
      /output/node_modules/@enterpriseglue/plugin-runtime/package.json \
  && cp -R packages/plugin-runtime/dist \
      /output/node_modules/@enterpriseglue/plugin-runtime/dist \
  && cp packages/plugin-sdk/package.json \
      /output/node_modules/@enterpriseglue/plugin-sdk/package.json \
  && cp -R packages/plugin-sdk/dist \
      /output/node_modules/@enterpriseglue/plugin-sdk/dist \
  && cp -RL packages/plugin-sdk/node_modules/zod /output/node_modules/zod

FROM node:24.10.0-alpine3.22
RUN addgroup -S -g 65532 reference \
  && adduser -S -D -H -u 65532 -G reference reference \
  && mkdir -p /var/lib/enterpriseglue/reference-health \
  && chown 65532:65532 /var/lib/enterpriseglue/reference-health
WORKDIR /opt/enterpriseglue/reference-plugin
COPY --from=build --chown=65532:65532 /output ./
COPY --from=build --chown=65532:65532 \
  /workspace/packages/plugin-reference/schemas ./schemas
COPY --from=build --chown=65532:65532 --chmod=0555 \
  /workspace/packages/plugin-reference/scripts/plugin-healthcheck.mjs \
  /usr/local/bin/plugin-healthcheck
ENV NODE_ENV=production
ENV PORT=8080
USER 65532:65532
EXPOSE 8080
CMD ["node", "dist/backend.js"]
