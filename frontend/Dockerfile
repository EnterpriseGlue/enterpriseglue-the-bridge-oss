FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY --chown=node:node . .

EXPOSE 5173

USER node

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
