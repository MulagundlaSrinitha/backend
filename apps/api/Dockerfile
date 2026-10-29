# syntax=docker/dockerfile:1

# ─── Stage 1: install dependencies (monorepo, api workspace only) ────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
# npm workspaces requires every manifest in the root workspaces glob to be
# present before `npm ci` can resolve the lockfile — copy them all.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/customer-app/package.json apps/customer-app/package.json
COPY apps/delivery-app/package.json apps/delivery-app/package.json
COPY apps/vendor-dashboard/package.json apps/vendor-dashboard/package.json
COPY apps/admin-panel/package.json apps/admin-panel/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN npm ci --workspace @next360/api --include-workspace-root --no-audit --no-fund

# ─── Stage 2: generate Prisma client + compile NestJS ────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV PATH=/app/node_modules/.bin:$PATH
COPY --from=deps /app/node_modules ./node_modules
# Only what the API build needs (context is .dockerignore-slimmed)
COPY package.json package-lock.json turbo.json ./
COPY apps/api ./apps/api
COPY prisma ./prisma
COPY packages ./packages
# Prisma schema lives at the repo root (prisma/schema.prisma)
RUN npx prisma generate --schema prisma/schema.prisma
# Compile the NestJS app → apps/api/dist
RUN npm run build --workspace @next360/api

# ─── Stage 3: slim runtime ────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/prisma ./prisma
EXPOSE 4000
WORKDIR /app/apps/api
# PORT (injected by Railway/Render/Fly) wins; API_PORT is the explicit override
CMD ["node", "dist/main.js"]
