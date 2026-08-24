FROM node:24.13.1-alpine3.23@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03 AS build

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/plugin-runtime/package.json packages/plugin-runtime/package.json
COPY packages/plugin-installer/package.json packages/plugin-installer/package.json
COPY packages/plugin-manager/package.json packages/plugin-manager/package.json

RUN --mount=type=cache,id=enterpriseglue-pnpm,target=/root/.local/share/pnpm/store \
  corepack enable \
  && corepack prepare pnpm@11.0.8 --activate \
  && pnpm install --frozen-lockfile \
      --filter @enterpriseglue/plugin-manager... \
      --ignore-scripts

COPY packages/plugin-sdk packages/plugin-sdk
COPY packages/plugin-runtime packages/plugin-runtime
COPY packages/plugin-installer packages/plugin-installer
COPY packages/plugin-manager packages/plugin-manager

RUN pnpm --filter @enterpriseglue/plugin-sdk build \
  && pnpm --filter @enterpriseglue/plugin-runtime build \
  && pnpm --filter @enterpriseglue/plugin-installer build \
  && pnpm --filter @enterpriseglue/plugin-manager build \
  && mkdir -p /packs /output \
  && pnpm --filter @enterpriseglue/plugin-sdk pack --pack-destination /packs \
  && pnpm --filter @enterpriseglue/plugin-runtime pack --pack-destination /packs \
  && pnpm --filter @enterpriseglue/plugin-installer pack --pack-destination /packs \
  && pnpm --filter @enterpriseglue/plugin-manager pack --pack-destination /packs \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-sdk-*.tgz' | wc -l)" -eq 1 \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-runtime-*.tgz' | wc -l)" -eq 1 \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-installer-*.tgz' | wc -l)" -eq 1 \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-manager-*.tgz' | wc -l)" -eq 1 \
  && npm install --prefix /output --omit=dev --omit=peer --legacy-peer-deps \
      /packs/enterpriseglue-plugin-sdk-*.tgz \
      /packs/enterpriseglue-plugin-runtime-*.tgz \
      /packs/enterpriseglue-plugin-installer-*.tgz \
      /packs/enterpriseglue-plugin-manager-*.tgz

FROM ghcr.io/oras-project/oras:v1.3.3@sha256:a4c54befd87d0366e0ba3ac3a9536a5288c8a3735acd3b635cdace59a2c559c8 AS oras

FROM ghcr.io/sigstore/cosign/cosign:v3.1.2@sha256:d91bc4e7e95e8d2f549c747a72dc174f90579e410a1695f57f686674f84ce849 AS cosign

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk add --no-cache ca-certificates nodejs docker-cli docker-cli-compose helm kubectl tini \
  && addgroup -S -g 65532 pluginmanager \
  && adduser -S -D -H -u 65532 -G pluginmanager pluginmanager \
  && mkdir -p /usr/share/licenses/enterpriseglue-plugin-manager \
  && mkdir -p /var/lib/enterpriseglue/plugin-manager \
  && chown -R 65532:65532 /var/lib/enterpriseglue/plugin-manager

WORKDIR /opt/enterpriseglue/plugin-manager
COPY --from=build --chown=65532:65532 /output ./
COPY --from=oras /bin/oras /usr/local/bin/oras
COPY --from=cosign /ko-app/cosign /usr/local/bin/cosign
COPY LICENSE /usr/share/licenses/enterpriseglue-plugin-manager/Apache-2.0.txt
COPY packages/plugin-manager/CONTAINER_THIRD_PARTY_NOTICES.md /usr/share/licenses/enterpriseglue-plugin-manager/CONTAINER_THIRD_PARTY_NOTICES.md

ENV NODE_ENV=production
USER 65532:65532
EXPOSE 8788
ENTRYPOINT ["/sbin/tini", "--", "node", "/opt/enterpriseglue/plugin-manager/node_modules/@enterpriseglue/plugin-manager/dist/cli.js", "serve"]
