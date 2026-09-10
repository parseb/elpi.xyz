#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# elpi (elpi.xyz) Local Devnet Orchestrator & Dev Console Harness
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RPC_PORT=8545
APP_PORT=3000
# Default to 31337 (standard Anvil/Hardhat localhost ID) so external wallets (Rabby, MetaMask)
# prompt transactions for Anvil instead of defaulting to Base Mainnet (8453).
# Set CHAIN_ID=8453 ./dev.sh if explicitly testing Base fork mode.
CHAIN_ID="${CHAIN_ID:-31337}"
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

ANVIL_PID=""
APP_PID=""

# ─── Process Tree Cleanup (kill_tree) ──────────────────────────────────────────

kill_tree() {
  local pid="$1"
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  echo ""
  echo "🧹 Cleaning up background processes..."
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    echo "  Terminating web frontend (PID: $APP_PID)..."
    kill_tree "$APP_PID"
  fi
  if [ -n "$ANVIL_PID" ] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "  Terminating Anvil node (PID: $ANVIL_PID)..."
    kill_tree "$ANVIL_PID"
  fi
  echo "✅ Devnet shutdown complete."
}

trap cleanup EXIT INT TERM

# ─── Helper Functions ──────────────────────────────────────────────────────────

is_port_open() {
  local port="$1"
  curl -s -m 1 "http://127.0.0.1:$port" >/dev/null 2>&1 || nc -z 127.0.0.1 "$port" 2>/dev/null || return 1
  return 0
}

wait_for_rpc() {
  local retries=30
  while [ $retries -gt 0 ]; do
    if curl -s -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
    retries=$((retries - 1))
  done
  return 1
}

# ─── 1. Probe & Spawn EVM Node (Anvil) ────────────────────────────────────────

echo "=== elpi (elpi.xyz) Devnet Bootstrap ==="
if is_port_open "$RPC_PORT"; then
  echo "✔ EVM RPC node is already running on port $RPC_PORT."
else
  echo "🚀 Launching Anvil local devnet on port $RPC_PORT (Chain ID: $CHAIN_ID)..."
  anvil --port "$RPC_PORT" --chain-id "$CHAIN_ID" > /tmp/elpi-anvil.log 2>&1 &
  ANVIL_PID=$!
  echo "  Anvil process started (PID: $ANVIL_PID, logs: /tmp/elpi-anvil.log)."

  if ! wait_for_rpc; then
    echo "❌ Failed to connect to Anvil on port $RPC_PORT."
    cat /tmp/elpi-anvil.log
    exit 1
  fi
  echo "✔ Anvil is healthy and accepting RPC requests."
fi

# ─── 2. Deploy Local Contracts & Seed Fixtures ────────────────────────────────

NEEDS_DEPLOYMENT=false
if [ ! -f "$DIR/local-anvil.json" ]; then
  NEEDS_DEPLOYMENT=true
else
  # Verify configured oracle and position manager code exists on chain
  ORACLE_ADDR=$(grep -o '"wethOracle": "[^"]*"' "$DIR/local-anvil.json" | cut -d'"' -f4 || echo "")
  PM_ADDR=$(grep -o '"positionManager": "[^"]*"' "$DIR/local-anvil.json" | cut -d'"' -f4 || echo "")
  if [ -z "$ORACLE_ADDR" ] || [ "$ORACLE_ADDR" = "0x0000000000000000000000000000000000000000" ] || [ -z "$PM_ADDR" ] || [ "$PM_ADDR" = "0x0000000000000000000000000000000000000000" ]; then
    NEEDS_DEPLOYMENT=true
  else
    CODE=$(cast code "$PM_ADDR" --rpc-url "http://127.0.0.1:$RPC_PORT" 2>/dev/null || echo "")
    if [ -z "$CODE" ] || [ "$CODE" = "0x" ]; then
      NEEDS_DEPLOYMENT=true
    fi
  fi
fi

if [ "$NEEDS_DEPLOYMENT" = true ]; then
  echo "📦 Deploying elpi × Uniswap v4 test fixtures via DeployLocal.s.sol..."
  forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url "http://127.0.0.1:$RPC_PORT" \
    --broadcast \
    --private-key "$DEPLOYER_KEY" > /tmp/elpi-deploy.log 2>&1
  echo "✔ Local deployment complete."

  if [ -f "$DIR/script/seed-liquidity.sh" ]; then
    echo "🌱 Seeding mock liquidity, allowances, and test quotes..."
    bash "$DIR/script/seed-liquidity.sh"
  fi
else
  echo "✔ Reusing existing deployment recorded in local-anvil.json."
fi

# ─── 3. Probe & Spawn Web Frontend ───────────────────────────────────────────

SKIP_APP=false
for arg in "$@"; do
  if [ "$arg" = "--no-app" ]; then
    SKIP_APP=true
  fi
done

if [ "$SKIP_APP" = false ]; then
  if is_port_open "$APP_PORT"; then
    echo "✔ Web frontend is already running on port $APP_PORT."
  elif [ -d "$DIR/app" ]; then
    echo "🌐 Starting Next.js web application on port $APP_PORT..."
    (cd "$DIR/app" && npm run dev > /tmp/elpi-app.log 2>&1) &
    APP_PID=$!
    echo "  Web app started (PID: $APP_PID, logs: /tmp/elpi-app.log)."
  fi
fi

# ─── 4. Launch Dev Console (Interactive or Programmatic) ──────────────────────

if [ $# -gt 0 ]; then
  # Filter out internal flags like --no-app
  FILTERED_ARGS=()
  for arg in "$@"; do
    if [ "$arg" != "--no-app" ]; then
      FILTERED_ARGS+=("$arg")
    fi
  done

  if [ ${#FILTERED_ARGS[@]} -gt 0 ]; then
    if [ "${FILTERED_ARGS[0]}" = "seed" ]; then
      bash "$DIR/script/seed-liquidity.sh"
      exit 0
    fi
    node --experimental-strip-types "$DIR/dev-console.ts" "${FILTERED_ARGS[@]}"
    exit 0
  fi
fi

# Launch Interactive REPL
node --experimental-strip-types "$DIR/dev-console.ts"
