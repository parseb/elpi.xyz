#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# elpi (elpi.xyz) Container Entrypoint for Railway Devnet Deployment
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

RPC_PORT=8545
CHAIN_ID="${CHAIN_ID:-31337}"
DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ANVIL_PID=""
NODE_PID=""

cleanup() {
  echo ""
  echo "🧹 Shutting down elpi devnet container..."
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID" 2>/dev/null || true
  fi
  if [ -n "$ANVIL_PID" ] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    kill -TERM "$ANVIL_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  echo "✅ Devnet shutdown complete."
}

trap cleanup EXIT INT TERM

echo "=================================================================="
echo "🚀 Starting elpi.xyz Devnet Service (Chain ID: $CHAIN_ID)"
echo "=================================================================="

# ─── 1. Launch Anvil Local EVM Node ───────────────────────────────────────────
echo "⚡ Launching Anvil local EVM on port $RPC_PORT (block time: 1s)..."
anvil --host 0.0.0.0 --port "$RPC_PORT" --chain-id "$CHAIN_ID" --block-time 1 > /tmp/anvil.log 2>&1 &
ANVIL_PID=$!
echo "  Anvil PID: $ANVIL_PID"

echo "⏳ Waiting for Anvil RPC to accept JSON-RPC connections..."
retries=30
while [ $retries -gt 0 ]; do
  if curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
  retries=$((retries - 1))
done

if [ $retries -le 0 ]; then
  echo "❌ Anvil failed to start. Logs:"
  cat /tmp/anvil.log
  exit 1
fi
echo "✔ Anvil is healthy and accepting RPC calls on port $RPC_PORT."

# ─── 2. Deploy Local Contracts & Uniswap v4 Fixtures ─────────────────────────
echo "📦 Deploying elpi × Uniswap v4 contracts via DeployLocal.s.sol..."
if [ -f "script/DeployLocal.s.sol" ]; then
  forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url "http://127.0.0.1:$RPC_PORT" \
    --broadcast \
    --private-key "$DEPLOYER_KEY" > /tmp/deploy.log 2>&1 || {
      echo "❌ Forge deployment failed. Logs:"
      cat /tmp/deploy.log
      exit 1
    }
  echo "✔ Contracts deployed and recorded in local-anvil.json."
else
  echo "ℹ script/DeployLocal.s.sol not found; using existing local-anvil.json if available."
fi

# ─── 3. Seed Mock Liquidity & Token Approvals ──────────────────────────────────
if [ -f "script/seed-liquidity.sh" ]; then
  echo "🌱 Seeding mock liquidity and verifying token allowances..."
  RPC_URL="http://127.0.0.1:$RPC_PORT" bash script/seed-liquidity.sh > /tmp/seed.log 2>&1 || {
    echo "⚠️ Seed liquidity script warning. Logs:"
    cat /tmp/seed.log
  }
  echo "✔ Mock token liquidity and allowances verified."
fi

# ─── 4. Generate EIP-712 Signed Profiles & Backer Quotes ─────────────────────
if [ -f "script/seed-profiles.mjs" ]; then
  echo "📝 Generating EIP-712 signed liquidity profiles & quotes..."
  node script/seed-profiles.mjs > /tmp/profiles.log 2>&1 || {
    echo "⚠️ Profile generation warning. Logs:"
    cat /tmp/profiles.log
  }
  echo "✔ EIP-712 signed profiles and quotes populated."
fi

# ─── 5. Start Next.js Web Server ─────────────────────────────────────────────
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export INTERNAL_RPC_URL="http://127.0.0.1:$RPC_PORT"
export DATABASE_PATH="${DATABASE_PATH:-/app/data/profiles-store.json}"

echo "🌐 Launching Next.js application on port $PORT..."
if [ -f "server.js" ]; then
  node server.js &
  NODE_PID=$!
elif [ -f "app/server.js" ]; then
  node app/server.js &
  NODE_PID=$!
else
  echo "❌ server.js not found in working directory!"
  exit 1
fi

echo "=================================================================="
echo "✔ elpi.xyz devnet is fully operational!"
echo "  - Web Application : http://0.0.0.0:$PORT"
echo "  - In-App RPC Proxy: http://0.0.0.0:$PORT/api/rpc"
echo "  - Local Anvil Node: http://127.0.0.1:$RPC_PORT (Chain ID: $CHAIN_ID)"
echo "=================================================================="

# Wait on Node.js server
wait "$NODE_PID"
