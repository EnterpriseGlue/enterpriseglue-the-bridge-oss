FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node frontend/package.json frontend/package-lock.json ./
COPY --chown=node:node packages /packages
RUN npm ci --include=dev --no-audit --no-fund

COPY --chown=node:node frontend ./

EXPOSE 5173

USER node

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
