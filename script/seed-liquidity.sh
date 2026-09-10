#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# elpi (elpi.xyz) Liquidity & Quote Seeding Script for Local Devnet
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
OUTPUT_DIR="$DIR/script/output"
mkdir -p "$OUTPUT_DIR"

CONFIG_FILE="$DIR/local-anvil.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Configuration file $CONFIG_FILE not found. Run deployment first."
  exit 1
fi

echo "=== elpi (elpi.xyz) Liquidity & Data Seeding ==="
echo "  RPC Target: $RPC_URL"

# Extract contract and account addresses from local-anvil.json
WETH=$(jq -r '.tokens.WETH.address' "$CONFIG_FILE")
WBTC=$(jq -r '.tokens.WBTC.address' "$CONFIG_FILE")
USDC=$(jq -r '.tokens.USDC.address' "$CONFIG_FILE")

VAULT=$(jq -r '.contracts.v4LiquidityVault' "$CONFIG_FILE")
POOL_MANAGER=$(jq -r '.contracts.poolManager' "$CONFIG_FILE")
ADAPTER=$(jq -r '.contracts.venueAdapter' "$CONFIG_FILE")
VENUE=$(jq -r '.contracts.mockSettlementVenue' "$CONFIG_FILE")
WETH_ORACLE=$(jq -r '.contracts.wethOracle' "$CONFIG_FILE")
WBTC_ORACLE=$(jq -r '.contracts.wbtcOracle' "$CONFIG_FILE")
POSITION_MANAGER=$(jq -r '.contracts.positionManager' "$CONFIG_FILE")
LP_ROUTER=$(jq -r '.contracts.lpRouter' "$CONFIG_FILE")
REGISTRY=$(jq -r '.contracts.erc6551Registry // "0x000000006551c19487814612e58FE06813775758"' "$CONFIG_FILE")

# Guarantee canonical ERC-6551 Registry code on Anvil
REG_CODE=""
if [ -f "$DIR/out/ERC6551Registry.sol/ERC6551Registry.json" ]; then
  REG_CODE=$(jq -r '.deployedBytecode.object' "$DIR/out/ERC6551Registry.sol/ERC6551Registry.json" 2>/dev/null || echo "")
fi
if [ -z "$REG_CODE" ] || [ "$REG_CODE" = "null" ]; then
  REG_CODE=$(cast code "$REGISTRY" --rpc-url "$RPC_URL" 2>/dev/null || echo "")
fi
if [ -n "$REG_CODE" ] && [ "$REG_CODE" != "0x" ] && [ "$REG_CODE" != "null" ]; then
  echo "  Etching canonical ERC6551Registry to 0x000000006551c19487814612e58FE06813775758..."
  cast rpc anvil_setCode 0x000000006551c19487814612e58FE06813775758 "$REG_CODE" --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
fi

ELPI1_KEY="0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa"
ELPI2_KEY="0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4"
ELPI3_KEY="0x4f6640b8640a7981a1c1f13b600f848c860f51a0e33fd445713d21ced84628c5"

ELPI1_ADDR=$(jq -r '.accounts.elpi1 // .accounts.lp' "$CONFIG_FILE")
ELPI2_ADDR=$(jq -r '.accounts.elpi2 // .accounts.taker' "$CONFIG_FILE")
ELPI3_ADDR=$(jq -r '.accounts.elpi3 // .accounts.taker2' "$CONFIG_FILE")

echo "✔ Personas loaded:"
echo "  - LP (elpi1)     : $ELPI1_ADDR"
echo "  - Taker 1 (elpi2): $ELPI2_ADDR"
echo "  - Taker 2 (elpi3): $ELPI3_ADDR"
echo "  - V4 Vault       : $VAULT"
echo "  - Pool Manager   : $POOL_MANAGER"
echo "  - PositionManager: $POSITION_MANAGER"
echo "  - LPRouter       : $LP_ROUTER"

# ─── 1. Verify / Refresh Allowances ──────────────────────────────────────────

echo "🔒 Verifying pre-approvals for protocol venues & vaults..."

# Helper: ensure max allowance
ensure_allowance() {
  local token="$1"
  local spender="$2"
  local owner="$3"
  local key="$4"
  local name="$5"

  local current=$(cast call "$token" "allowance(address,address)(uint256)" "$owner" "$spender" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
  # Check if allowance is zero or small
  if [ "$current" = "0" ]; then
    echo "  Approving $name ($spender) for token $token from $owner..."
    cast send "$token" "approve(address,uint256)" "$spender" "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
      --private-key "$key" --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
  fi
}

ensure_allowance "$WETH" "$VAULT" "$ELPI1_ADDR" "$ELPI1_KEY" "V4LiquidityVault"
ensure_allowance "$WBTC" "$VAULT" "$ELPI1_ADDR" "$ELPI1_KEY" "V4LiquidityVault"
ensure_allowance "$USDC" "$VAULT" "$ELPI1_ADDR" "$ELPI1_KEY" "V4LiquidityVault"
ensure_allowance "$WETH" "$ADAPTER" "$ELPI1_ADDR" "$ELPI1_KEY" "VenueAdapter"
ensure_allowance "$WBTC" "$ADAPTER" "$ELPI1_ADDR" "$ELPI1_KEY" "VenueAdapter"
ensure_allowance "$USDC" "$ADAPTER" "$ELPI1_ADDR" "$ELPI1_KEY" "VenueAdapter"
ensure_allowance "$WETH" "$VENUE" "$ELPI1_ADDR" "$ELPI1_KEY" "MockSettlementVenue"
ensure_allowance "$WBTC" "$VENUE" "$ELPI1_ADDR" "$ELPI1_KEY" "MockSettlementVenue"
ensure_allowance "$USDC" "$VENUE" "$ELPI1_ADDR" "$ELPI1_KEY" "MockSettlementVenue"
ensure_allowance "$WETH" "$POSITION_MANAGER" "$ELPI1_ADDR" "$ELPI1_KEY" "PositionManager"
ensure_allowance "$WBTC" "$POSITION_MANAGER" "$ELPI1_ADDR" "$ELPI1_KEY" "PositionManager"
ensure_allowance "$USDC" "$POSITION_MANAGER" "$ELPI1_ADDR" "$ELPI1_KEY" "PositionManager"
ensure_allowance "$WETH" "$LP_ROUTER" "$ELPI1_ADDR" "$ELPI1_KEY" "LPRouter"
ensure_allowance "$WBTC" "$LP_ROUTER" "$ELPI1_ADDR" "$ELPI1_KEY" "LPRouter"
ensure_allowance "$USDC" "$LP_ROUTER" "$ELPI1_ADDR" "$ELPI1_KEY" "LPRouter"

ensure_allowance "$WETH" "$ADAPTER" "$ELPI2_ADDR" "$ELPI2_KEY" "VenueAdapter"
ensure_allowance "$WBTC" "$ADAPTER" "$ELPI2_ADDR" "$ELPI2_KEY" "VenueAdapter"
ensure_allowance "$USDC" "$ADAPTER" "$ELPI2_ADDR" "$ELPI2_KEY" "VenueAdapter"
ensure_allowance "$WETH" "$VENUE" "$ELPI2_ADDR" "$ELPI2_KEY" "MockSettlementVenue"
ensure_allowance "$WBTC" "$VENUE" "$ELPI2_ADDR" "$ELPI2_KEY" "MockSettlementVenue"
ensure_allowance "$USDC" "$VENUE" "$ELPI2_ADDR" "$ELPI2_KEY" "MockSettlementVenue"
ensure_allowance "$WETH" "$POSITION_MANAGER" "$ELPI2_ADDR" "$ELPI2_KEY" "PositionManager"
ensure_allowance "$WBTC" "$POSITION_MANAGER" "$ELPI2_ADDR" "$ELPI2_KEY" "PositionManager"
ensure_allowance "$USDC" "$POSITION_MANAGER" "$ELPI2_ADDR" "$ELPI2_KEY" "PositionManager"
ensure_allowance "$WETH" "$LP_ROUTER" "$ELPI2_ADDR" "$ELPI2_KEY" "LPRouter"
ensure_allowance "$WBTC" "$LP_ROUTER" "$ELPI2_ADDR" "$ELPI2_KEY" "LPRouter"
ensure_allowance "$USDC" "$LP_ROUTER" "$ELPI2_ADDR" "$ELPI2_KEY" "LPRouter"

ensure_allowance "$WETH" "$ADAPTER" "$ELPI3_ADDR" "$ELPI3_KEY" "VenueAdapter"
ensure_allowance "$WBTC" "$ADAPTER" "$ELPI3_ADDR" "$ELPI3_KEY" "VenueAdapter"
ensure_allowance "$USDC" "$ADAPTER" "$ELPI3_ADDR" "$ELPI3_KEY" "VenueAdapter"
ensure_allowance "$WETH" "$VENUE" "$ELPI3_ADDR" "$ELPI3_KEY" "MockSettlementVenue"
ensure_allowance "$WBTC" "$VENUE" "$ELPI3_ADDR" "$ELPI3_KEY" "MockSettlementVenue"
ensure_allowance "$USDC" "$VENUE" "$ELPI3_ADDR" "$ELPI3_KEY" "MockSettlementVenue"
ensure_allowance "$WETH" "$POSITION_MANAGER" "$ELPI3_ADDR" "$ELPI3_KEY" "PositionManager"
ensure_allowance "$WBTC" "$POSITION_MANAGER" "$ELPI3_ADDR" "$ELPI3_KEY" "PositionManager"
ensure_allowance "$USDC" "$POSITION_MANAGER" "$ELPI3_ADDR" "$ELPI3_KEY" "PositionManager"
ensure_allowance "$WETH" "$LP_ROUTER" "$ELPI3_ADDR" "$ELPI3_KEY" "LPRouter"
ensure_allowance "$WBTC" "$LP_ROUTER" "$ELPI3_ADDR" "$ELPI3_KEY" "LPRouter"
ensure_allowance "$USDC" "$LP_ROUTER" "$ELPI3_ADDR" "$ELPI3_KEY" "LPRouter"

echo "✔ Token allowances verified and active."

# ─── 2. Verify V4 Liquidity Vault Staged Position ─────────────────────────────

echo "🌊 Checking Uniswap v4 staged liquidity in V4LiquidityVault..."
VAULT_OWNER=$(cast call "$VAULT" "owner()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "")
TICK_LOWER=$(cast call "$VAULT" "tickLower()(int24)" --rpc-url "$RPC_URL" 2>/dev/null || echo "")
TICK_UPPER=$(cast call "$VAULT" "tickUpper()(int24)" --rpc-url "$RPC_URL" 2>/dev/null || echo "")
PM_WETH=$(cast call "$WETH" "balanceOf(address)(uint256)" "$POOL_MANAGER" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
VAULT_WETH=$(cast call "$WETH" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")

echo "  Vault Owner: $VAULT_OWNER"
echo "  Tick Range : [$TICK_LOWER, $TICK_UPPER]"
echo "  PoolManager WETH Collateral: $(cast from-wei "$PM_WETH" 2>/dev/null || echo "$PM_WETH") WETH"
echo "  Vault Loose WETH Balance   : $(cast from-wei "$VAULT_WETH" 2>/dev/null || echo "$VAULT_WETH") WETH"

# ─── 3. Generate & Sign EIP-712 / ERC-1271 Backer Quotes ──────────────────────

echo "✍️  Generating seeded backer quotes signed by LP ($ELPI1_ADDR)..."

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
EXPIRY1=$((NOW + 604800))  # 7 days
EXPIRY2=$((NOW + 1209600)) # 14 days
EXPIRY3=$((NOW + 2592000)) # 30 days

# Generate unique digests for 3 option quotes:
# Quote 1: WETH Put (Strike 2800 USDC, 5 WETH capacity)
DIGEST1=$(cast keccak $(echo -n "QUOTE_WETH_PUT_2800_${NOW}_${VAULT}" | xxd -p -c 256))
SIG1=$(cast wallet sign --no-hash "$DIGEST1" --private-key "$ELPI1_KEY")
MAGIC1=$(cast call "$VAULT" "isValidSignature(bytes32,bytes)(bytes4)" "$DIGEST1" "$SIG1" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x00000000")

# Quote 2: WETH Call (Strike 3400 USDC, 5 WETH capacity)
DIGEST2=$(cast keccak $(echo -n "QUOTE_WETH_CALL_3400_${NOW}_${VAULT}" | xxd -p -c 256))
SIG2=$(cast wallet sign --no-hash "$DIGEST2" --private-key "$ELPI1_KEY")
MAGIC2=$(cast call "$VAULT" "isValidSignature(bytes32,bytes)(bytes4)" "$DIGEST2" "$SIG2" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x00000000")

# Quote 3: WBTC Call (Strike 65000 USDC, 1 WBTC capacity)
DIGEST3=$(cast keccak $(echo -n "QUOTE_WBTC_CALL_65000_${NOW}_${VAULT}" | xxd -p -c 256))
SIG3=$(cast wallet sign --no-hash "$DIGEST3" --private-key "$ELPI1_KEY")
MAGIC3=$(cast call "$VAULT" "isValidSignature(bytes32,bytes)(bytes4)" "$DIGEST3" "$SIG3" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x00000000")

echo "  Quote 1 ERC-1271 verification: $MAGIC1 (expected: 0x1626ba7e)"
echo "  Quote 2 ERC-1271 verification: $MAGIC2 (expected: 0x1626ba7e)"
echo "  Quote 3 ERC-1271 verification: $MAGIC3 (expected: 0x1626ba7e)"

QUOTES_JSON="$OUTPUT_DIR/seeded-quotes.json"
cat > "$QUOTES_JSON" <<EOF
{
  "timestamp": $NOW,
  "isoDate": "$(date -u -d @"$NOW" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "vault": "$VAULT",
  "lpOwner": "$ELPI1_ADDR",
  "quotes": [
    {
      "id": "quote-weth-put-2800",
      "type": "PUT",
      "underlying": "WETH",
      "underlyingAddress": "$WETH",
      "settlementAsset": "$USDC",
      "strikeUsd": "2800.00",
      "strikeRay": "2800000000",
      "premiumUsd": "75.00",
      "premiumUnits": "75000000",
      "capacityUnits": "5000000000000000000",
      "capacityFormatted": "5.0 WETH",
      "expiry": $EXPIRY1,
      "expiryDate": "$(date -u -d @"$EXPIRY1" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$EXPIRY1")",
      "backer": "$VAULT",
      "signer": "$ELPI1_ADDR",
      "digest": "$DIGEST1",
      "signature": "$SIG1",
      "erc1271Valid": $([ "$MAGIC1" = "0x1626ba7e" ] && echo "true" || echo "false")
    },
    {
      "id": "quote-weth-call-3400",
      "type": "CALL",
      "underlying": "WETH",
      "underlyingAddress": "$WETH",
      "settlementAsset": "$USDC",
      "strikeUsd": "3400.00",
      "strikeRay": "3400000000",
      "premiumUsd": "110.00",
      "premiumUnits": "110000000",
      "capacityUnits": "5000000000000000000",
      "capacityFormatted": "5.0 WETH",
      "expiry": $EXPIRY2,
      "expiryDate": "$(date -u -d @"$EXPIRY2" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$EXPIRY2")",
      "backer": "$VAULT",
      "signer": "$ELPI1_ADDR",
      "digest": "$DIGEST2",
      "signature": "$SIG2",
      "erc1271Valid": $([ "$MAGIC2" = "0x1626ba7e" ] && echo "true" || echo "false")
    },
    {
      "id": "quote-wbtc-call-65000",
      "type": "CALL",
      "underlying": "WBTC",
      "underlyingAddress": "$WBTC",
      "settlementAsset": "$USDC",
      "strikeUsd": "65000.00",
      "strikeRay": "65000000000",
      "premiumUsd": "2400.00",
      "premiumUnits": "2400000000",
      "capacityUnits": "100000000",
      "capacityFormatted": "1.0 WBTC",
      "expiry": $EXPIRY3,
      "expiryDate": "$(date -u -d @"$EXPIRY3" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$EXPIRY3")",
      "backer": "$VAULT",
      "signer": "$ELPI1_ADDR",
      "digest": "$DIGEST3",
      "signature": "$SIG3",
      "erc1271Valid": $([ "$MAGIC3" = "0x1626ba7e" ] && echo "true" || echo "false")
    }
  ]
}
EOF

echo "✔ Seeded quotes written to $QUOTES_JSON"

if [ -f "$DIR/script/seed-profiles.mjs" ]; then
  echo "🖋️  Generating and signing realistic scaled market profiles & quotes..."
  node "$DIR/script/seed-profiles.mjs"
fi

echo "🎉 Data and liquidity seeding complete."
