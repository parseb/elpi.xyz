import type { Address, Hex } from "viem";

let localAnvil: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  localAnvil = require("./local-anvil.json");
} catch {
  // fallback if file does not exist
}

// Configured for elpi x Uniswap v4 (Base Chain ID: 8453 / Anvil Local)
// Matches local-anvil.json produced by DeployLocal.s.sol
export const addresses = {
  chainId: Number(process.env.NEXT_PUBLIC_DEV_CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || localAnvil?.chainId || 31337),

  // Tokens
  collateralAsset: (process.env.NEXT_PUBLIC_BASE_WETH || localAnvil?.tokens?.WETH?.address || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address, // WETH
  settlementAsset: (process.env.NEXT_PUBLIC_BASE_USDC || localAnvil?.tokens?.USDC?.address || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as Address, // USDC
  wbtcAsset: (process.env.NEXT_PUBLIC_BASE_WBTC || localAnvil?.tokens?.WBTC?.address || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address, // WBTC
  wstethAsset: "0x7f39C581F595B53c5cb19bD0b3f8dA6C935E2Ca0" as Address,
  nvdaAsset: "0x0000000000000000000000000000000000000000" as Address,

  // Uniswap v4 Infrastructure
  poolManager: (process.env.NEXT_PUBLIC_BASE_POOL_MANAGER || localAnvil?.contracts?.poolManager || "0x610178dA211FEF7D417bC0e6FeD39F05609AD788") as Address,
  venueAdapter: (process.env.NEXT_PUBLIC_BASE_VENUE_ADAPTER || localAnvil?.contracts?.venueAdapter || "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e") as Address, // UniswapV4VenueAdapter
  settlementVenue: (process.env.NEXT_PUBLIC_BASE_MOCK_VENUE || localAnvil?.contracts?.mockSettlementVenue || "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e") as Address,
  btcSettlementVenue: (process.env.NEXT_PUBLIC_BASE_MOCK_VENUE || localAnvil?.contracts?.mockSettlementVenue || "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707") as Address,
  nvdaSettlementVenue: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address,
  v4LiquidityVault: (process.env.NEXT_PUBLIC_BASE_VAULT || localAnvil?.contracts?.v4LiquidityVault || "0x9A676e781A523b5d0C0e43731313A708CB607508") as Address, // V4LiquidityVault (Stages idle collateral in Uniswap v4)
  routeId: (process.env.NEXT_PUBLIC_BASE_ROUTE_ID || localAnvil?.uniswapV4?.routeId || "0xc7c4d3ce8b62bf174096deb50284295b1926530a83767d684bf66f5412643385") as Hex,

  // Oracles
  priceOracle: (process.env.NEXT_PUBLIC_BASE_CHAINLINK_ETH_USD || localAnvil?.contracts?.wethOracle || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as Address, // WETH MockPriceOracle
  btcPriceOracle: (process.env.NEXT_PUBLIC_BASE_WBTC_ORACLE || localAnvil?.contracts?.wbtcOracle || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9") as Address, // WBTC MockPriceOracle
  nvdaPriceOracle: "0x0000000000000000000000000000000000000000" as Address,

  // Protocol Core & Signers
  authzModule: (process.env.NEXT_PUBLIC_BASE_AUTHZ_MODULE || localAnvil?.contracts?.authzModule || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address,
  conditionArbiter: (process.env.NEXT_PUBLIC_BASE_CONDITION_ARBITER || localAnvil?.contracts?.conditionArbiter || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as Address,
  positionAccountImplementation: (process.env.NEXT_PUBLIC_BASE_POSITION_ACCOUNT_IMPL || localAnvil?.contracts?.positionAccountImplementation || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address,
  positionManager: (process.env.NEXT_PUBLIC_BASE_POSITION_MANAGER || localAnvil?.contracts?.positionManager || "0x9A676e781A523b5d0C0e43731313A708CB607508") as Address,
  lpRouter: (process.env.NEXT_PUBLIC_BASE_LP_ROUTER || localAnvil?.contracts?.lpRouter || "0x9A676e781A523b5d0C0e43731313A708CB607508") as Address,
  expiryCondition: (process.env.NEXT_PUBLIC_BASE_EXPIRY_CONDITION || localAnvil?.contracts?.expiryCondition || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as Address,
  takerProfitCondition: (process.env.NEXT_PUBLIC_BASE_TAKER_PROFIT_CONDITION || localAnvil?.contracts?.takerProfitCondition || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9") as Address,
  dustCondition: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address,
  neverCondition: "0x0165878A594ca255338adfa4d48449f69242Eb8F" as Address,
  erc6551Registry: (process.env.NEXT_PUBLIC_BASE_ERC6551_REGISTRY || localAnvil?.contracts?.erc6551Registry || "0x000000006551c19487814612e58FE06813775758") as Address,
  feeVault: (localAnvil?.accounts?.feeVault || "0x6C02839e831b680aB61D5De8AfF676e9a878e825") as Address,
  deployer: (localAnvil?.accounts?.deployer || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") as Address,
} as const;
