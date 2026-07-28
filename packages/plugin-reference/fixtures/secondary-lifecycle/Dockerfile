FROM node:24.10.0-alpine3.22@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083

WORKDIR /opt/enterpriseglue/reference-health-secondary
COPY --chown=65532:65532 \
  packages/plugin-reference/fixtures/secondary-lifecycle/server.mjs \
  ./server.mjs

ENV NODE_ENV=production
ENV PORT=8080
ARG SECONDARY_PLUGIN_VERSION=0.1.0
ENV SECONDARY_PLUGIN_VERSION=$SECONDARY_PLUGIN_VERSION
ARG SECONDARY_PLUGIN_MODE=ready
ENV SECONDARY_PLUGIN_MODE=$SECONDARY_PLUGIN_MODE
USER 65532:65532
EXPOSE 8080
CMD ["node", "server.mjs"]
