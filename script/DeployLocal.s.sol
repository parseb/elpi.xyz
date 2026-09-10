// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {UniswapV4VenueAdapter} from "../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../src/periphery/V4LiquidityVault.sol";

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {MockSettlementVenue} from "../src/mocks/MockSettlementVenue.sol";

import {ERC6551Registry} from "../lib/reference/src/ERC6551Registry.sol";
import {PositionAccount} from "../src/PositionAccount.sol";
import {PositionManager} from "../artefacts/src/PositionManager.sol";
import {LPRouter} from "../artefacts/src/periphery/LPRouter.sol";
import {AuthzModule} from "../artefacts/src/AuthzModule.sol";
import {ConditionArbiter} from "../artefacts/src/ConditionArbiter.sol";
import {ExpiryCondition} from "../artefacts/src/conditions/ExpiryCondition.sol";
import {TakerProfitCondition} from "../artefacts/src/conditions/TakerProfitCondition.sol";

/// @title DeployLocal
/// @notice Deterministic local deployment script for elpi x Uniswap v4 with dev console fixtures.
///         Exports deployment configuration to local-anvil.json and .local.env.
contract DeployLocal is Script {
    uint160 public constant REQUIRED_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG; // 0xC8 = 200

    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    int24 public constant DEFAULT_TICK_SPACING = 60;
    uint160 public constant INITIAL_SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Standard Anvil Personas (Accounts 0-3)
    address public constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address public constant ANVIL_LP = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address public constant ANVIL_TAKER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address public constant ANVIL_FEE_VAULT = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    // Deterministic Personas derived from "elpi1" .. "elpi5"
    uint256 public constant ELPI1_PK = uint256(keccak256("elpi1"));
    uint256 public constant ELPI2_PK = uint256(keccak256("elpi2"));
    uint256 public constant ELPI3_PK = uint256(keccak256("elpi3"));
    uint256 public constant ELPI4_PK = uint256(keccak256("elpi4"));
    uint256 public constant ELPI5_PK = uint256(keccak256("elpi5"));

    address public constant ELPI1_ADDR = 0xf85B008086EA4f59f17aE9E0665962a1e45c7855; // LP / Maker with Uniswap positions
    address public constant ELPI2_ADDR = 0x61755DF0a398ee315bcC077d99B5eaC7c73ca813; // Taker 1 / Trader
    address public constant ELPI3_ADDR = 0xEB1b98c730a0fA3F3419cb201D343D509767865b; // Taker 2 / Settlement
    address public constant ELPI4_ADDR = 0x4A60DB79Eede5e98f8b71f78D1b6d311ECDD8885; // Secondary LP / Maker
    address public constant ELPI5_ADDR = 0x6C02839e831b680aB61D5De8AfF676e9a878e825; // Fee Vault / Governance

    address public constant ELPI1_HASH_ADDR = 0x7A62FaA21E0C30F865C4e9ABC599Aab8BCB7e7fA;
    address public constant ELPI2_HASH_ADDR = 0x5529510D49436a578DC5B57eDe07A2bE0866c0b4;
    address public constant ELPI3_HASH_ADDR = 0x600F848C860F51A0e33fd445713d21ced84628C5;
    address public constant ELPI4_HASH_ADDR = 0xb07061dEE9df63a7b6DaDBfBe4B27a07B73A681c;
    address public constant ELPI5_HASH_ADDR = 0x9Dc9C01d355f03d991bf53fd00D2eD27e2Da527C;

    address public constant LP_PERSONA = ELPI1_ADDR;
    address public constant TAKER_PERSONA = ELPI2_ADDR;
    address public constant TAKER2_PERSONA = ELPI3_ADDR;
    address public constant FEE_VAULT = ELPI5_ADDR;

    struct OptionStack {
        address registry;
        AuthzModule authzModule;
        ConditionArbiter conditionArbiter;
        ExpiryCondition expiryCondition;
        TakerProfitCondition takerProfitCondition;
        PositionAccount positionAccount;
        PositionManager positionManager;
        LPRouter lpRouter;
    }

    struct LocalDeployment {
        MockERC20 weth;
        MockERC20 wbtc;
        MockERC20 usdc;
        MockPriceOracle wethOracle;
        MockPriceOracle wbtcOracle;
        MockSettlementVenue mockVenue;
        IPoolManager poolManager;
        UniswapV4VenueAdapter venueAdapter;
        address hook;
        V4LiquidityVault vault;
        bytes32 routeId;
        PoolKey poolKey;
        OptionStack opt;
    }

    function run() external returns (LocalDeployment memory deployed) {
        address deployer = msg.sender;
        vm.startBroadcast();
        deployed = deployLocalStack(deployer);
        vm.stopBroadcast();

        exportConfig(deployed);
    }

    function deployLocalStack() external returns (LocalDeployment memory) {
        return deployLocalStack(msg.sender);
    }

    function deployLocalStack(address deployer) public returns (LocalDeployment memory deployed) {
        console.log("=== elpi Local Devnet Deployment ===");
        console.log("Deployer:", deployer);

        // 1. Deploy Mock Tokens
        deployed.weth = new MockERC20("Wrapped Ether", "WETH", 18);
        deployed.wbtc = new MockERC20("Wrapped Bitcoin", "WBTC", 8);
        deployed.usdc = new MockERC20("USD Coin", "USDC", 6);
        console.log("WETH deployed at:", address(deployed.weth));
        console.log("WBTC deployed at:", address(deployed.wbtc));
        console.log("USDC deployed at:", address(deployed.usdc));

        // 2. Deploy Mock Oracles (1e18 normalized)
        // WETH = $3,000, WBTC = $60,000
        deployed.wethOracle =
            new MockPriceOracle(address(deployed.weth), address(deployed.usdc), 3000 * 1e18, 8, "ETH / USD");
        deployed.wbtcOracle =
            new MockPriceOracle(address(deployed.wbtc), address(deployed.usdc), 60000 * 1e18, 8, "BTC / USD");
        console.log("WETH MockPriceOracle deployed at:", address(deployed.wethOracle));
        console.log("WBTC MockPriceOracle deployed at:", address(deployed.wbtcOracle));

        // 3. Deploy Controllable Settlement Venue
        deployed.mockVenue = new MockSettlementVenue();
        // Set initial rate matching WETH = $3000
        // numerator = (3000 * 1e18 * 1e6) / 1e18 = 3000 * 1e6
        // denominator = 1e18
        deployed.mockVenue.setRate(3000 * 1e6, 1e18);

        // Pre-fund venue with reserves
        deployed.usdc.mint(address(deployed.mockVenue), 1_000_000 * 1e6);
        deployed.weth.mint(address(deployed.mockVenue), 1_000 * 1e18);
        deployed.wbtc.mint(address(deployed.mockVenue), 100 * 1e8);
        console.log("MockSettlementVenue deployed at:", address(deployed.mockVenue));

        // 4. Deploy Uniswap v4 Stack with Liquidity Collateralization
        deployed.poolManager = IPoolManager(address(new PoolManager(address(0))));
        console.log("v4 PoolManager deployed at:", address(deployed.poolManager));

        deployed.venueAdapter = new UniswapV4VenueAdapter(address(deployed.poolManager));
        console.log("UniswapV4VenueAdapter deployed at:", address(deployed.venueAdapter));

        deployed.hook = address(0);

        // Setup route in adapter for WETH/USDC
        (address c0, address c1) = address(deployed.weth) < address(deployed.usdc)
            ? (address(deployed.weth), address(deployed.usdc))
            : (address(deployed.usdc), address(deployed.weth));

        deployed.poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        try deployed.poolManager.initialize(deployed.poolKey, INITIAL_SQRT_PRICE_1_1) {} catch {}
        deployed.venueAdapter.registerRoute(deployed.poolKey, "");
        deployed.routeId = keccak256(abi.encode(deployed.poolKey));
        console.log("Uniswap v4 Route registered. RouteId:", vm.toString(deployed.routeId));

        // 5. Deploy Option Core & Periphery Stack
        ERC6551Registry reg = new ERC6551Registry();
        deployed.opt.registry = address(0x000000006551c19487814612e58FE06813775758);
        vm.etch(deployed.opt.registry, address(reg).code);
        console.log("ERC6551Registry deployed and etched at:", deployed.opt.registry);

        deployed.opt.authzModule = new AuthzModule();
        console.log("AuthzModule deployed at:", address(deployed.opt.authzModule));

        deployed.opt.conditionArbiter = new ConditionArbiter();
        console.log("ConditionArbiter deployed at:", address(deployed.opt.conditionArbiter));

        deployed.opt.expiryCondition = new ExpiryCondition();
        console.log("ExpiryCondition deployed at:", address(deployed.opt.expiryCondition));

        deployed.opt.takerProfitCondition = new TakerProfitCondition();
        console.log("TakerProfitCondition deployed at:", address(deployed.opt.takerProfitCondition));

        deployed.opt.positionAccount = new PositionAccount(address(deployed.opt.authzModule), FEE_VAULT);
        console.log("PositionAccount implementation deployed at:", address(deployed.opt.positionAccount));

        deployed.opt.positionManager = new PositionManager(address(deployed.opt.positionAccount));
        console.log("PositionManager deployed at:", address(deployed.opt.positionManager));

        deployed.opt.lpRouter = new LPRouter(address(deployed.opt.positionManager));
        console.log("LPRouter deployed at:", address(deployed.opt.lpRouter));

        // 6. Deploy V4LiquidityVault for LP collateral staging
        bool isWethCurrency0 = c0 == address(deployed.weth);
        int24 vaultTickLower = isWethCurrency0 ? int24(600) : int24(-1200);
        int24 vaultTickUpper = isWethCurrency0 ? int24(1200) : int24(-600);

        deployed.vault = new V4LiquidityVault(
            address(deployed.poolManager),
            deployed.poolKey,
            vaultTickLower,
            vaultTickUpper,
            LP_PERSONA,
            address(deployed.opt.lpRouter)
        );
        console.log("V4LiquidityVault deployed at:", address(deployed.vault));

        // 7. Fund Personas & Gas
        _fundAccounts(deployed);

        // 8. Seed LP Uniswap v4 Staged Liquidity Position & Pre-Approvals
        _seedLPAndApprovals(deployed, deployer);

        console.log("=== Deployment Complete ===");
    }

    function _fundAccounts(LocalDeployment memory d) internal {
        bool isBroadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);

        address[10] memory ethRecipients = [
            ELPI1_ADDR,
            ELPI2_ADDR,
            ELPI3_ADDR,
            ELPI4_ADDR,
            ELPI5_ADDR,
            ELPI1_HASH_ADDR,
            ELPI2_HASH_ADDR,
            ELPI3_HASH_ADDR,
            ANVIL_LP,
            ANVIL_TAKER
        ];

        for (uint256 i = 0; i < ethRecipients.length; i++) {
            if (isBroadcast) {
                payable(ethRecipients[i]).transfer(5 ether);
            } else {
                vm.deal(ethRecipients[i], 100 ether);
            }
        }

        // elpi1 (LP)
        d.weth.mint(ELPI1_ADDR, 100 * 1e18);
        d.wbtc.mint(ELPI1_ADDR, 10 * 1e8);
        d.usdc.mint(ELPI1_ADDR, 100_000 * 1e6);
        d.weth.mint(ELPI1_HASH_ADDR, 10 * 1e18);
        d.usdc.mint(ELPI1_HASH_ADDR, 10_000 * 1e6);

        // elpi2 (Taker 1)
        d.weth.mint(ELPI2_ADDR, 50 * 1e18);
        d.wbtc.mint(ELPI2_ADDR, 5 * 1e8);
        d.usdc.mint(ELPI2_ADDR, 50_000 * 1e6);
        d.weth.mint(ELPI2_HASH_ADDR, 10 * 1e18);
        d.usdc.mint(ELPI2_HASH_ADDR, 10_000 * 1e6);

        // elpi3 (Taker 2)
        d.weth.mint(ELPI3_ADDR, 50 * 1e18);
        d.wbtc.mint(ELPI3_ADDR, 5 * 1e8);
        d.usdc.mint(ELPI3_ADDR, 50_000 * 1e6);
        d.weth.mint(ELPI3_HASH_ADDR, 10 * 1e18);
        d.usdc.mint(ELPI3_HASH_ADDR, 10_000 * 1e6);

        // elpi4 (Secondary LP)
        d.weth.mint(ELPI4_ADDR, 50 * 1e18);
        d.wbtc.mint(ELPI4_ADDR, 5 * 1e8);
        d.usdc.mint(ELPI4_ADDR, 50_000 * 1e6);

        // elpi5 (Fee Vault)
        d.usdc.mint(ELPI5_ADDR, 10_000 * 1e6);

        // standard Anvil personas
        d.weth.mint(ANVIL_LP, 100 * 1e18);
        d.wbtc.mint(ANVIL_LP, 10 * 1e8);
        d.usdc.mint(ANVIL_LP, 100_000 * 1e6);

        d.weth.mint(ANVIL_TAKER, 50 * 1e18);
        d.wbtc.mint(ANVIL_TAKER, 5 * 1e8);
        d.usdc.mint(ANVIL_TAKER, 50_000 * 1e6);

        d.weth.mint(DEPLOYER, 100 * 1e18);
        d.wbtc.mint(DEPLOYER, 10 * 1e8);
        d.usdc.mint(DEPLOYER, 100_000 * 1e6);
        d.usdc.mint(ANVIL_FEE_VAULT, 10_000 * 1e6);
    }

    function _seedLPAndApprovals(LocalDeployment memory d, address deployer) internal {
        bool isBroadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        uint256 depositAmount = 25 * 1e18; // 25 WETH staked into Uniswap v4

        if (!isBroadcast) {
            vm.startPrank(LP_PERSONA);
            d.weth.approve(address(d.vault), type(uint256).max);
            d.usdc.approve(address(d.vault), type(uint256).max);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            d.vault.deposit(address(d.weth), depositAmount);
            vm.stopPrank();

            vm.startPrank(TAKER_PERSONA);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            vm.stopPrank();

            vm.startPrank(TAKER2_PERSONA);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            vm.stopPrank();
        } else {
            vm.stopBroadcast();

            vm.startBroadcast(ELPI1_PK);
            d.weth.approve(address(d.vault), type(uint256).max);
            d.usdc.approve(address(d.vault), type(uint256).max);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            d.vault.deposit(address(d.weth), depositAmount);
            vm.stopBroadcast();

            vm.startBroadcast(ELPI2_PK);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            vm.stopBroadcast();

            vm.startBroadcast(ELPI3_PK);
            d.weth.approve(address(d.venueAdapter), type(uint256).max);
            d.usdc.approve(address(d.venueAdapter), type(uint256).max);
            d.weth.approve(address(d.mockVenue), type(uint256).max);
            d.usdc.approve(address(d.mockVenue), type(uint256).max);
            d.weth.approve(address(d.opt.positionManager), type(uint256).max);
            d.usdc.approve(address(d.opt.positionManager), type(uint256).max);
            d.weth.approve(address(d.opt.lpRouter), type(uint256).max);
            d.usdc.approve(address(d.opt.lpRouter), type(uint256).max);
            vm.stopBroadcast();

            vm.startBroadcast(deployer);
        }

        console.log("LP Uniswap v4 position staged: 25 WETH deposited in V4LiquidityVault");
        console.log("Pre-approvals configured for LP and Takers.");
    }

    function exportConfig(LocalDeployment memory d) public {
        exportJson(d);
        exportEnv(d);
        exportAppEnv(d);
    }

    function exportJson(LocalDeployment memory d) internal {
        string memory jc1 = string.concat(
            '    "poolManager": "', vm.toString(address(d.poolManager)), '",\n',
            '    "venueAdapter": "', vm.toString(address(d.venueAdapter)), '",\n',
            '    "optionSettlementHook": "', vm.toString(address(d.hook)), '",\n'
        );
        string memory jc2 = string.concat(
            '    "v4LiquidityVault": "', vm.toString(address(d.vault)), '",\n',
            '    "mockSettlementVenue": "', vm.toString(address(d.mockVenue)), '",\n',
            '    "wethOracle": "', vm.toString(address(d.wethOracle)), '",\n',
            '    "wbtcOracle": "', vm.toString(address(d.wbtcOracle)), '",\n'
        );
        string memory jc3 = string.concat(
            '    "positionManager": "', vm.toString(address(d.opt.positionManager)), '",\n',
            '    "lpRouter": "', vm.toString(address(d.opt.lpRouter)), '",\n',
            '    "positionAccountImplementation": "', vm.toString(address(d.opt.positionAccount)), '",\n',
            '    "authzModule": "', vm.toString(address(d.opt.authzModule)), '",\n'
        );
        string memory jc4 = string.concat(
            '    "conditionArbiter": "', vm.toString(address(d.opt.conditionArbiter)), '",\n',
            '    "expiryCondition": "', vm.toString(address(d.opt.expiryCondition)), '",\n',
            '    "takerProfitCondition": "', vm.toString(address(d.opt.takerProfitCondition)), '",\n',
            '    "erc6551Registry": "', vm.toString(d.opt.registry), '"\n'
        );
        string memory jHead = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "rpcUrl": "http://127.0.0.1:8545",\n',
            '  "contracts": {\n'
        );
        string memory jsonPart1 = string.concat(jHead, jc1, jc2, jc3, jc4, "  },\n");

        string memory jt1 = string.concat(
            '  "tokens": {\n',
            '    "WETH": { "address": "', vm.toString(address(d.weth)), '", "decimals": 18, "symbol": "WETH" },\n',
            '    "WBTC": { "address": "', vm.toString(address(d.wbtc)), '", "decimals": 8, "symbol": "WBTC" },\n'
        );
        string memory jt2 = string.concat(
            '    "USDC": { "address": "', vm.toString(address(d.usdc)), '", "decimals": 6, "symbol": "USDC" }\n',
            "  },\n"
        );
        string memory ju1 = string.concat(
            '  "uniswapV4": {\n',
            '    "routeId": "', vm.toString(d.routeId), '",\n',
            '    "currency0": "', vm.toString(Currency.unwrap(d.poolKey.currency0)), '",\n',
            '    "currency1": "', vm.toString(Currency.unwrap(d.poolKey.currency1)), '",\n'
        );
        string memory ju2 = string.concat(
            '    "fee": 8388608,\n',
            '    "tickSpacing": 60,\n',
            '    "hooks": "', vm.toString(address(d.poolKey.hooks)), '"\n',
            "  },\n"
        );
        string memory jsonPart2 = string.concat(jt1, jt2, ju1, ju2);

        string memory p3a = string.concat(
            '  "accounts": {\n',
            '    "deployer": "', vm.toString(DEPLOYER), '",\n',
            '    "lp": "', vm.toString(LP_PERSONA), '",\n',
            '    "taker": "', vm.toString(TAKER_PERSONA), '",\n'
        );
        string memory p3b = string.concat(
            '    "taker2": "', vm.toString(TAKER2_PERSONA), '",\n',
            '    "maker2": "', vm.toString(ELPI4_ADDR), '",\n',
            '    "feeVault": "', vm.toString(FEE_VAULT), '",\n',
            '    "anvilLp": "', vm.toString(ANVIL_LP), '",\n'
        );
        string memory p3c = string.concat(
            '    "anvilTaker": "', vm.toString(ANVIL_TAKER), '",\n',
            '    "elpi1": "', vm.toString(ELPI1_ADDR), '",\n',
            '    "elpi2": "', vm.toString(ELPI2_ADDR), '",\n',
            '    "elpi3": "', vm.toString(ELPI3_ADDR), '",\n'
        );
        string memory p3d = string.concat(
            '    "elpi4": "', vm.toString(ELPI4_ADDR), '",\n',
            '    "elpi5": "', vm.toString(ELPI5_ADDR), '"\n',
            "  }\n}\n"
        );
        string memory jsonPart3 = string.concat(p3a, p3b, p3c, p3d);

        string memory fullJson = string.concat(jsonPart1, jsonPart2, jsonPart3);
        try vm.writeFile("local-anvil.json", fullJson) {
            console.log("Wrote local-anvil.json");
        } catch {
            console.log("Notice: Unable to write local-anvil.json");
        }
        try vm.writeFile("app/src/config/local-anvil.json", fullJson) {
            console.log("Wrote app/src/config/local-anvil.json");
        } catch {}
    }

    function exportEnv(LocalDeployment memory d) internal {
        string memory e1a = string.concat(
            "RPC_URL=http://127.0.0.1:8545\nCHAIN_ID=", vm.toString(block.chainid), "\n",
            "DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80\n",
            "LP_KEY=0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa\n"
        );
        string memory e1b = string.concat(
            "TAKER_KEY=0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4\n",
            "TAKER2_KEY=0x4f6640b8640a7981a1c1f13b600f848c860f51a0e33fd445713d21ced84628c5\n",
            "ELPI1_KEY=0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa\n"
        );
        string memory e1c = string.concat(
            "ELPI2_KEY=0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4\n",
            "ELPI3_KEY=0x4f6640b8640a7981a1c1f13b600f848c860f51a0e33fd445713d21ced84628c5\n",
            "ELPI4_KEY=0x0f8f6c5bbc9446e503c9ce07b07061dee9df63a7b6dadbfbe4b27a07b73a681c\n",
            "ELPI5_KEY=0xd2d6c980974d227a149ba5b49dc9c01d355f03d991bf53fd00d2ed27e2da527c\n"
        );
        string memory e1d = string.concat(
            "ANVIL_LP_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d\n",
            "ANVIL_TAKER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a\n"
        );
        string memory env1 = string.concat(e1a, e1b, e1c, e1d);

        string memory e2a = string.concat(
            "POOL_MANAGER=", vm.toString(address(d.poolManager)), "\n",
            "VENUE_ADAPTER=", vm.toString(address(d.venueAdapter)), "\n",
            "OPTION_HOOK=", vm.toString(address(d.hook)), "\n",
            "V4_LIQUIDITY_VAULT=", vm.toString(address(d.vault)), "\n"
        );
        string memory e2b = string.concat(
            "MOCK_SETTLEMENT_VENUE=", vm.toString(address(d.mockVenue)), "\n",
            "WETH=", vm.toString(address(d.weth)), "\n",
            "WBTC=", vm.toString(address(d.wbtc)), "\n",
            "USDC=", vm.toString(address(d.usdc)), "\n"
        );
        string memory e2c = string.concat(
            "WETH_ORACLE=", vm.toString(address(d.wethOracle)), "\n",
            "WBTC_ORACLE=", vm.toString(address(d.wbtcOracle)), "\n",
            "ROUTE_ID=", vm.toString(d.routeId), "\n"
        );
        string memory env2 = string.concat(e2a, e2b, e2c);

        string memory e3a = string.concat(
            "POSITION_MANAGER=", vm.toString(address(d.opt.positionManager)), "\n",
            "LP_ROUTER=", vm.toString(address(d.opt.lpRouter)), "\n",
            "AUTHZ_MODULE=", vm.toString(address(d.opt.authzModule)), "\n",
            "CONDITION_ARBITER=", vm.toString(address(d.opt.conditionArbiter)), "\n"
        );
        string memory e3b = string.concat(
            "POSITION_ACCOUNT_IMPL=", vm.toString(address(d.opt.positionAccount)), "\n",
            "EXPIRY_CONDITION=", vm.toString(address(d.opt.expiryCondition)), "\n",
            "TAKER_PROFIT_CONDITION=", vm.toString(address(d.opt.takerProfitCondition)), "\n",
            "ERC6551_REGISTRY=", vm.toString(d.opt.registry), "\n"
        );
        string memory env3 = string.concat(e3a, e3b);

        string memory fullEnv = string.concat(env1, env2, env3);
        try vm.writeFile(".local.env", fullEnv) {
            console.log("Wrote .local.env");
        } catch {
            console.log("Notice: Unable to write .local.env");
        }
    }

    function exportAppEnv(LocalDeployment memory d) internal {
        string memory appEnv1 = string.concat(
            "NEXT_PUBLIC_CHAIN_ID=", vm.toString(block.chainid), "\n",
            "NEXT_PUBLIC_DEV_CHAIN_ID=", vm.toString(block.chainid), "\n",
            "NEXT_PUBLIC_BASE_RPC_URL=http://127.0.0.1:8545\n",
            "NEXT_PUBLIC_BASE_POOL_MANAGER=", vm.toString(address(d.poolManager)), "\n"
        );

        string memory a2a = string.concat(
            "NEXT_PUBLIC_BASE_VENUE_ADAPTER=", vm.toString(address(d.venueAdapter)), "\n",
            "NEXT_PUBLIC_BASE_OPTION_HOOK=", vm.toString(address(d.hook)), "\n",
            "NEXT_PUBLIC_BASE_VAULT=", vm.toString(address(d.vault)), "\n",
            "NEXT_PUBLIC_BASE_WETH=", vm.toString(address(d.weth)), "\n"
        );
        string memory a2b = string.concat(
            "NEXT_PUBLIC_BASE_WBTC=", vm.toString(address(d.wbtc)), "\n",
            "NEXT_PUBLIC_BASE_USDC=", vm.toString(address(d.usdc)), "\n",
            "NEXT_PUBLIC_BASE_CHAINLINK_ETH_USD=", vm.toString(address(d.wethOracle)), "\n",
            "NEXT_PUBLIC_BASE_MOCK_VENUE=", vm.toString(address(d.mockVenue)), "\n",
            "NEXT_PUBLIC_BASE_ROUTE_ID=", vm.toString(d.routeId), "\n"
        );
        string memory appEnv2 = string.concat(a2a, a2b);

        string memory a3a = string.concat(
            "NEXT_PUBLIC_BASE_POSITION_MANAGER=", vm.toString(address(d.opt.positionManager)), "\n",
            "NEXT_PUBLIC_BASE_LP_ROUTER=", vm.toString(address(d.opt.lpRouter)), "\n",
            "NEXT_PUBLIC_BASE_AUTHZ_MODULE=", vm.toString(address(d.opt.authzModule)), "\n",
            "NEXT_PUBLIC_BASE_CONDITION_ARBITER=", vm.toString(address(d.opt.conditionArbiter)), "\n"
        );
        string memory a3b = string.concat(
            "NEXT_PUBLIC_BASE_POSITION_ACCOUNT_IMPL=", vm.toString(address(d.opt.positionAccount)), "\n",
            "NEXT_PUBLIC_BASE_EXPIRY_CONDITION=", vm.toString(address(d.opt.expiryCondition)), "\n",
            "NEXT_PUBLIC_BASE_TAKER_PROFIT_CONDITION=", vm.toString(address(d.opt.takerProfitCondition)), "\n",
            "NEXT_PUBLIC_BASE_ERC6551_REGISTRY=", vm.toString(d.opt.registry), "\n"
        );
        string memory appEnv3 = string.concat(a3a, a3b);

        string memory fullAppEnv = string.concat(appEnv1, appEnv2, appEnv3);
        try vm.writeFile("app/.env.local", fullAppEnv) {
            console.log("Wrote app/.env.local");
        } catch {
            console.log("Notice: Unable to write app/.env.local");
        }
    }
}
