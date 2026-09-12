# Production Dockerfile for elpi / uniopt (Next.js 16 Standalone)
FROM node:20-slim AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY app/package.json app/package-lock.json* ./
RUN npm install

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_TARGET_CHAIN=base
ENV NEXT_PUBLIC_CHAIN_ID=8453

RUN npm run build

# Production Runner stage
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_PATH="/app/data/profiles-store.json"

# Create persistent data directory for LP profiles & backer quotes
RUN mkdir -p /app/data && chmod 777 /app/data

# Copy Next.js standalone output & static assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
