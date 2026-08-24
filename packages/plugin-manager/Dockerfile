FROM --platform=$BUILDPLATFORM node:24.13.1-alpine3.23@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03 AS build

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
      /packs/enterpriseglue-plugin-manager-*.tgz \
  && test -z "$(find /output -type f -name '*.node' -print -quit)"

FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine3.23@sha256:e57c41c1d5864341031181b0db34b9a537bb5773eb6428e4e5bdaea0f9135406 AS oras

ARG TARGETOS
ARG TARGETARCH
ENV GOBIN=/out \
    GOTOOLCHAIN=local
RUN CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go install oras.land/oras/cmd/oras@v1.3.3 \
  && test -x /out/oras
RUN mkdir -p /cosign-build \
  && cd /cosign-build \
  && go mod init enterpriseglue.local/cosign-build \
  && go get github.com/sigstore/cosign/v3/cmd/cosign@v3.1.3 \
  && go get google.golang.org/grpc@v1.82.1 \
      golang.org/x/mod@v0.40.0 \
      golang.org/x/text@v0.39.0 \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -buildvcs=false -trimpath \
        -ldflags='-buildid= -X sigs.k8s.io/release-utils/version.gitVersion=v3.1.3-enterpriseglue.1 -X sigs.k8s.io/release-utils/version.gitCommit=11926fa5bbbbde47e88fc006b625a17769b743b2 -X sigs.k8s.io/release-utils/version.gitTreeState=clean -X sigs.k8s.io/release-utils/version.buildDate=2026-08-06T00:10:15Z' \
        -o /out/cosign github.com/sigstore/cosign/v3/cmd/cosign \
  && go version -m /out/cosign | grep -E 'golang.org/x/mod[[:space:]]+v0\.40\.0' \
  && go version -m /out/cosign | grep -E 'golang.org/x/text[[:space:]]+v0\.39\.0' \
  && go version -m /out/cosign | grep -E 'google.golang.org/grpc[[:space:]]+v1\.82\.1'

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk add --no-cache ca-certificates nodejs docker-cli docker-cli-compose helm kubectl tini \
  && addgroup -S -g 65532 pluginmanager \
  && adduser -S -D -H -u 65532 -G pluginmanager pluginmanager \
  && mkdir -p /usr/share/licenses/enterpriseglue-plugin-manager \
  && mkdir -p /var/lib/enterpriseglue/plugin-manager \
  && chown -R 65532:65532 /var/lib/enterpriseglue/plugin-manager

WORKDIR /opt/enterpriseglue/plugin-manager
COPY --from=build --chown=65532:65532 /output ./
COPY --from=oras /out/oras /usr/local/bin/oras
COPY --from=oras /out/cosign /usr/local/bin/cosign
COPY LICENSE /usr/share/licenses/enterpriseglue-plugin-manager/Apache-2.0.txt
COPY packages/plugin-manager/CONTAINER_THIRD_PARTY_NOTICES.md /usr/share/licenses/enterpriseglue-plugin-manager/CONTAINER_THIRD_PARTY_NOTICES.md

ENV NODE_ENV=production
USER 65532:65532
EXPOSE 8788
ENTRYPOINT ["/sbin/tini", "--", "node", "/opt/enterpriseglue/plugin-manager/node_modules/@enterpriseglue/plugin-manager/dist/cli.js", "serve"]
