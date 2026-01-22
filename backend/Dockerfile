FROM node:20-alpine

WORKDIR /app

# For some native deps (if any) we might need build tools, but keep it lean for now.

COPY backend/package.json backend/package-lock.json ./backend/
COPY packages ./packages
RUN npm --prefix backend ci --include=dev --no-audit --no-fund

COPY backend ./backend

WORKDIR /app/backend

# Build TypeScript (skip db:generate as it requires interactive input)
# Migrations are included in the repo and run automatically at startup
RUN npm run build:skip-generate

EXPOSE 8787

CMD ["npm", "run", "start"]
