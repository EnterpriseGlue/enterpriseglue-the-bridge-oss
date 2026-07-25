FROM node:22-alpine

WORKDIR /app
COPY customer-sidecar-reference.mjs customer-sidecar-reference-server.mjs ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "customer-sidecar-reference-server.mjs"]
