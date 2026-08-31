FROM --platform=$BUILDPLATFORM node:24.10.0-alpine3.22@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083 AS build

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
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-sdk-*.tgz' | wc -l)" -eq 1 \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-runtime-*.tgz' | wc -l)" -eq 1 \
  && test "$(find /packs -maxdepth 1 -name 'enterpriseglue-plugin-installer-*.tgz' | wc -l)" -eq 1 \
  && npm install --prefix /output --omit=dev --omit=peer --legacy-peer-deps \
      /packs/enterpriseglue-plugin-sdk-*.tgz \
      /packs/enterpriseglue-plugin-runtime-*.tgz \
      /packs/enterpriseglue-plugin-installer-*.tgz \
  && test -z "$(find /output -type f -name '*.node' -print -quit)"

FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine3.23@sha256:e57c41c1d5864341031181b0db34b9a537bb5773eb6428e4e5bdaea0f9135406 AS oras

ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=local
RUN --mount=type=cache,id=enterpriseglue-plugin-toolchain-go-modules,target=/go/pkg/mod,sharing=locked \
  --mount=type=cache,id=enterpriseglue-plugin-toolchain-go-build,target=/root/.cache/go-build,sharing=locked \
  retry() { \
    attempt=1; \
    while ! "$@"; do \
      if [ "$attempt" -ge 3 ]; then return 1; fi; \
      attempt=$((attempt + 1)); \
      sleep $((attempt * 2)); \
    done; \
  } \
  && mkdir -p /oras-build /out \
  && cd /oras-build \
  && go mod init enterpriseglue.local/oras-build \
  && retry go get oras.land/oras/cmd/oras@v1.3.4 \
      golang.org/x/crypto@v0.55.0 \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -buildvcs=false -trimpath -o /out/oras oras.land/oras/cmd/oras \
  && test -x /out/oras \
  && go version -m /out/oras | grep -E 'golang.org/x/crypto[[:space:]]+v0\.55\.0'
RUN --mount=type=cache,id=enterpriseglue-plugin-toolchain-go-modules,target=/go/pkg/mod,sharing=locked \
  --mount=type=cache,id=enterpriseglue-plugin-toolchain-go-build,target=/root/.cache/go-build,sharing=locked \
  retry() { \
    attempt=1; \
    while ! "$@"; do \
      if [ "$attempt" -ge 3 ]; then return 1; fi; \
      attempt=$((attempt + 1)); \
      sleep $((attempt * 2)); \
    done; \
  } \
  && mkdir -p /cosign-build \
  && cd /cosign-build \
  && go mod init enterpriseglue.local/cosign-build \
  && retry go get github.com/sigstore/cosign/v3/cmd/cosign@v3.1.3 \
      golang.org/x/crypto@v0.55.0 \
      google.golang.org/grpc@v1.82.1 \
      golang.org/x/mod@v0.40.0 \
      golang.org/x/text@v0.41.0 \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -buildvcs=false -trimpath \
        -ldflags='-buildid= -X sigs.k8s.io/release-utils/version.gitVersion=v3.1.3-enterpriseglue.2 -X sigs.k8s.io/release-utils/version.gitCommit=11926fa5bbbbde47e88fc006b625a17769b743b2 -X sigs.k8s.io/release-utils/version.gitTreeState=clean -X sigs.k8s.io/release-utils/version.buildDate=2026-08-06T00:10:15Z' \
        -o /out/cosign github.com/sigstore/cosign/v3/cmd/cosign \
  && go version -m /out/cosign | grep -E 'golang.org/x/crypto[[:space:]]+v0\.55\.0' \
  && go version -m /out/cosign | grep -E 'golang.org/x/mod[[:space:]]+v0\.40\.0' \
  && go version -m /out/cosign | grep -E 'golang.org/x/text[[:space:]]+v0\.41\.0' \
  && go version -m /out/cosign | grep -E 'google.golang.org/grpc[[:space:]]+v1\.82\.1'

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk upgrade --no-cache \
  && apk add --no-cache ca-certificates nodejs docker-cli docker-cli-compose helm kubectl \
  && addgroup -S -g 65532 plugininstaller \
  && adduser -S -D -H -u 65532 -G plugininstaller plugininstaller \
  && mkdir -p /usr/share/licenses/enterpriseglue-plugin-installer

WORKDIR /opt/enterpriseglue/plugin-installer
COPY --from=build --chown=65532:65532 /output ./
COPY --from=oras /out/oras /usr/local/bin/oras
COPY --from=oras /out/cosign /usr/local/bin/cosign
COPY LICENSE /usr/share/licenses/enterpriseglue-plugin-installer/Apache-2.0.txt
COPY packages/plugin-installer/CONTAINER_THIRD_PARTY_NOTICES.md /usr/share/licenses/enterpriseglue-plugin-installer/CONTAINER_THIRD_PARTY_NOTICES.md

USER 65532:65532
ENTRYPOINT ["node", "/opt/enterpriseglue/plugin-installer/node_modules/@enterpriseglue/plugin-installer/dist/cli.js"]
