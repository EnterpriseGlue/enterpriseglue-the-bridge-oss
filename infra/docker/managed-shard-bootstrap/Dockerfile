# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646

USER root
RUN apk add --no-cache --upgrade \
      glibc-2.44 \
      glibc-2.44-dev \
      glibc-2.44-locale-posix \
      ld-linux-2.44 \
      libcrypt1-2.44

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
