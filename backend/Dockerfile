FROM node:20-alpine

WORKDIR /app

# For some native deps (if any) we might need build tools, but keep it lean for now.

COPY --chown=node:node backend/package.json backend/package-lock.json ./backend/
COPY --chown=node:node packages ./packages
RUN npm --prefix backend ci --include=dev --no-audit --no-fund

COPY --chown=node:node backend ./backend

WORKDIR /app/backend

# Build TypeScript (skip db:generate as it requires interactive input)
# Migrations are included in the repo and run automatically at startup
RUN npm run build:skip-generate

EXPOSE 8787

USER node

CMD ["npm", "run", "start"]
