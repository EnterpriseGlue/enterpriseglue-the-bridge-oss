FROM node:24.10.0-alpine3.22@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083 AS build

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/plugin-runtime/package.json packages/plugin-runtime/package.json
COPY packages/plugin-installer/package.json packages/plugin-installer/package.json

RUN --mount=type=cache,id=enterpriseglue-pnpm,target=/root/.local/share/pnpm/store \
  corepack enable \
  && corepack prepare pnpm@11.0.8 --activate \
  && pnpm install --frozen-lockfile \
      --filter @enterpriseglue/plugin-installer... \
      --ignore-scripts

COPY packages/plugin-sdk packages/plugin-sdk
COPY packages/plugin-runtime packages/plugin-runtime
COPY packages/plugin-installer packages/plugin-installer

RUN pnpm --filter @enterpriseglue/plugin-sdk build \
  && pnpm --filter @enterpriseglue/plugin-runtime build \
  && pnpm --filter @enterpriseglue/plugin-installer build \
  && mkdir -p /packs /output \
  && pnpm --filter @enterpriseglue/plugin-sdk pack --pack-destination /packs \
  && pnpm --filter @enterpriseglue/plugin-runtime pack --pack-destination /packs \
  && pnpm --filter @enterpriseglue/plugin-installer pack --pack-destination /packs \
  && npm install --prefix /output --omit=dev --omit=peer --legacy-peer-deps \
      /packs/enterpriseglue-plugin-sdk-0.2.0.tgz \
      /packs/enterpriseglue-plugin-runtime-0.1.0.tgz \
      /packs/enterpriseglue-plugin-installer-0.1.0.tgz

FROM ghcr.io/oras-project/oras:v1.3.3@sha256:a4c54befd87d0366e0ba3ac3a9536a5288c8a3735acd3b635cdace59a2c559c8 AS oras

FROM ghcr.io/sigstore/cosign/cosign:v3.1.2@sha256:d91bc4e7e95e8d2f549c747a72dc174f90579e410a1695f57f686674f84ce849 AS cosign

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk add --no-cache ca-certificates nodejs docker-cli docker-cli-compose helm kubectl \
  && addgroup -S -g 65532 plugininstaller \
  && adduser -S -D -H -u 65532 -G plugininstaller plugininstaller \
  && mkdir -p /usr/share/licenses/enterpriseglue-plugin-installer

WORKDIR /opt/enterpriseglue/plugin-installer
COPY --from=build --chown=65532:65532 /output ./
COPY --from=oras /bin/oras /usr/local/bin/oras
COPY --from=cosign /ko-app/cosign /usr/local/bin/cosign
COPY LICENSE /usr/share/licenses/enterpriseglue-plugin-installer/Apache-2.0.txt
COPY packages/plugin-installer/CONTAINER_THIRD_PARTY_NOTICES.md /usr/share/licenses/enterpriseglue-plugin-installer/CONTAINER_THIRD_PARTY_NOTICES.md

USER 65532:65532
ENTRYPOINT ["node", "/opt/enterpriseglue/plugin-installer/node_modules/@enterpriseglue/plugin-installer/dist/cli.js"]
