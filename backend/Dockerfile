FROM node:20-alpine

WORKDIR /app

# For some native deps (if any) we might need build tools, but keep it lean for now.

COPY --chown=node:node backend/package.json backend/package-lock.json ./
COPY --chown=node:node packages /packages
RUN npm ci --include=dev --no-audit --no-fund

COPY --chown=node:node backend ./

EXPOSE 8787

USER node

CMD ["npm", "run", "start"]
