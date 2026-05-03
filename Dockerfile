# syntax=docker/dockerfile:1
ARG VERSION=dev
FROM node:20-alpine AS build

WORKDIR /app

ENV APP_VERSION=$VERSION

COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm install --legacy-peer-deps

COPY server ./server
COPY client ./client

RUN npm run build

# ── production image ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server/package.json ./server/

RUN npm install --workspace=server --omit=dev

COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/index.js"]
