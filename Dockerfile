# ==============================================================================
# elpi (elpi.xyz) — Turnkey Devnet Dockerfile for Railway Partner Testing
# Bundles Foundry/Anvil EVM + Auto-Deployer + Next.js Standalone App + /api/rpc
# ==============================================================================

# ─── 1. Foundry Tools Stage ───────────────────────────────────────────────────
FROM ghcr.io/foundry-rs/foundry:latest AS foundry

# ─── 2. Node.js Base Stage ─────────────────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app

# ─── 3. Dependencies Stage ───────────────────────────────────────────────────
FROM base AS deps
COPY app/package.json app/package-lock.json* ./
RUN npm install

# ─── 4. Builder Stage (Contracts & Next.js) ───────────────────────────────────
FROM base AS builder
WORKDIR /app

# Install Foundry binaries in builder to pre-compile contracts
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/forge
COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast

# Pre-compile Solidity contracts & test fixtures
COPY foundry.toml remappings.txt ./
COPY src/ ./src/
COPY script/ ./script/
COPY lib/ ./lib/
RUN forge build

# Build Next.js standalone application targeting devnet Anvil
COPY --from=deps /app/node_modules ./app/node_modules
COPY app/ ./app/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_TARGET_CHAIN=anvil
ENV NEXT_PUBLIC_CHAIN_ID=31337
ENV NEXT_PUBLIC_DEV_RPC_URL=/api/rpc

WORKDIR /app/app
RUN npm run build

# ─── 5. Production Devnet Runner Stage ─────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# Install runtime utilities needed by Anvil & deployment scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Foundry tools into runner
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/forge
COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_TARGET_CHAIN=anvil
ENV NEXT_PUBLIC_CHAIN_ID=31337
ENV NEXT_PUBLIC_DEV_RPC_URL=/api/rpc
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_PATH="/app/data/profiles-store.json"

# Create persistent data directory for LP profiles & backer quotes
RUN mkdir -p /app/data && chmod 777 /app/data

# Copy contracts, scripts, and pre-compiled Foundry artifacts
COPY --from=builder /app/foundry.toml /app/remappings.txt ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/script ./script
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/out ./out
COPY --from=builder /app/app/package.json ./app/package.json
COPY --from=builder /app/app/package.json ./package.json

# Copy Next.js standalone output & static assets
COPY --from=builder /app/app/public ./public
COPY --from=builder /app/app/.next/standalone ./
COPY --from=builder /app/app/.next/static ./.next/static

# Copy startup entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
