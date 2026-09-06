// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {UniswapV4VenueAdapter} from "../src/adapters/UniswapV4VenueAdapter.sol";
import {OptionSettlementHook} from "../src/hooks/OptionSettlementHook.sol";
import {V4LiquidityVault} from "../src/periphery/V4LiquidityVault.sol";

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {MockSettlementVenue} from "../src/mocks/MockSettlementVenue.sol";

/// @title DeployLocal
/// @notice Deterministic local deployment script for elpi x Uniswap v4 with dev console fixtures.
///         Exports deployment configuration to local-anvil.json and .local.env.
contract DeployLocal is Script {
    uint160 public constant REQUIRED_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG; // 0xC8 = 200

    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    int24 public constant DEFAULT_TICK_SPACING = 60;
    uint160 public constant INITIAL_SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Standard Anvil Personas
    address public constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address public constant LP_PERSONA = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address public constant TAKER_PERSONA = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address public constant FEE_VAULT = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    struct LocalDeployment {
        MockERC20 weth;
        MockERC20 wbtc;
        MockERC20 usdc;
        MockPriceOracle wethOracle;
        MockPriceOracle wbtcOracle;
        MockSettlementVenue mockVenue;
        IPoolManager poolManager;
        UniswapV4VenueAdapter venueAdapter;
        OptionSettlementHook hook;
        V4LiquidityVault vault;
        bytes32 routeId;
        PoolKey poolKey;
    }

    function mineHookSalt(address deployer, bytes memory creationCode)
        public
        pure
        returns (bytes32 salt, address predicted)
    {
        bytes32 codeHash = keccak256(creationCode);
        for (uint256 i = 0; i < 500_000; i++) {
            bytes32 s = bytes32(i);
            address target = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, s, codeHash)))));
            if (uint160(target) & Hooks.ALL_HOOK_MASK == REQUIRED_FLAGS) {
                return (s, target);
            }
        }
        revert("DeployLocal: Failed to mine hook salt within range");
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

        // Mine salt and deploy hook via canonical CREATE2 factory (0x4e59b44847b379578588920cA78FbF26c0B4956C)
        address factory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        if (factory.code.length == 0) {
            vm.etch(
                factory,
                hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
            );
        }

        bytes memory hookCreationCode = abi.encodePacked(
            type(OptionSettlementHook).creationCode,
            abi.encode(deployed.poolManager, deployer, address(deployed.venueAdapter))
        );
        (bytes32 salt, address predictedHook) = mineHookSalt(factory, hookCreationCode);

        (bool success, bytes memory returnData) = factory.call(abi.encodePacked(salt, hookCreationCode));
        require(success && returnData.length == 20, "Hook CREATE2 deployment failed");
        address hookAddr;
        assembly {
            hookAddr := mload(add(returnData, 20))
        }
        deployed.hook = OptionSettlementHook(hookAddr);
        require(address(deployed.hook) == predictedHook, "Hook predicted address mismatch");

        // Authorize deployer and personas as position manager delegates in hook
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.prank(deployer);
            deployed.hook.addPositionManager(DEPLOYER);
            vm.prank(deployer);
            deployed.hook.addPositionManager(LP_PERSONA);
            vm.prank(deployer);
            deployed.hook.addPositionManager(TAKER_PERSONA);
        } else {
            deployed.hook.addPositionManager(DEPLOYER);
            deployed.hook.addPositionManager(LP_PERSONA);
            deployed.hook.addPositionManager(TAKER_PERSONA);
        }

        // Setup route in adapter for WETH/USDC
        (address c0, address c1) = address(deployed.weth) < address(deployed.usdc)
            ? (address(deployed.weth), address(deployed.usdc))
            : (address(deployed.usdc), address(deployed.weth));

        deployed.poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: deployed.hook
        });

        try deployed.poolManager.initialize(deployed.poolKey, INITIAL_SQRT_PRICE_1_1) {} catch {}
        deployed.venueAdapter.registerRoute(deployed.poolKey, "");
        deployed.routeId = keccak256(abi.encode(deployed.poolKey));
        console.log("Uniswap v4 Route registered. RouteId:", vm.toString(deployed.routeId));

        // 5. Deploy V4LiquidityVault for LP collateral staging
        deployed.vault = new V4LiquidityVault(
            address(deployed.poolManager),
            deployed.poolKey,
            600,
            1200,
            LP_PERSONA,
            DEPLOYER // lpRouter
        );
        console.log("V4LiquidityVault deployed at:", address(deployed.vault));

        // 6. Fund Personas
        // LP / Maker
        deployed.weth.mint(LP_PERSONA, 100 * 1e18);
        deployed.wbtc.mint(LP_PERSONA, 10 * 1e8);
        deployed.usdc.mint(LP_PERSONA, 100_000 * 1e6);

        // Taker / Trader
        deployed.weth.mint(TAKER_PERSONA, 50 * 1e18);
        deployed.wbtc.mint(TAKER_PERSONA, 5 * 1e8);
        deployed.usdc.mint(TAKER_PERSONA, 50_000 * 1e6);

        // Deployer / Fee Vault
        deployed.weth.mint(DEPLOYER, 100 * 1e18);
        deployed.wbtc.mint(DEPLOYER, 10 * 1e8);
        deployed.usdc.mint(DEPLOYER, 100_000 * 1e6);
        deployed.usdc.mint(FEE_VAULT, 10_000 * 1e6);

        console.log("Personas funded successfully.");
        console.log("=== Deployment Complete ===");
    }

    function exportConfig(LocalDeployment memory d) public {
        exportJson(d);
        exportEnv(d);
        exportAppEnv(d);
    }

    function exportJson(LocalDeployment memory d) internal {
        string memory jsonPart1 = string.concat(
            "{\n",
            '  "chainId": 8453,\n',
            '  "rpcUrl": "http://127.0.0.1:8545",\n',
            '  "contracts": {\n',
            '    "poolManager": "',
            vm.toString(address(d.poolManager)),
            '",\n',
            '    "venueAdapter": "',
            vm.toString(address(d.venueAdapter)),
            '",\n',
            '    "optionSettlementHook": "',
            vm.toString(address(d.hook)),
            '",\n',
            '    "v4LiquidityVault": "',
            vm.toString(address(d.vault)),
            '",\n',
            '    "mockSettlementVenue": "',
            vm.toString(address(d.mockVenue)),
            '",\n',
            '    "wethOracle": "',
            vm.toString(address(d.wethOracle)),
            '",\n',
            '    "wbtcOracle": "',
            vm.toString(address(d.wbtcOracle)),
            '"\n',
            "  },\n"
        );

        string memory jsonPart2 = string.concat(
            '  "tokens": {\n',
            '    "WETH": { "address": "',
            vm.toString(address(d.weth)),
            '", "decimals": 18, "symbol": "WETH" },\n',
            '    "WBTC": { "address": "',
            vm.toString(address(d.wbtc)),
            '", "decimals": 8, "symbol": "WBTC" },\n',
            '    "USDC": { "address": "',
            vm.toString(address(d.usdc)),
            '", "decimals": 6, "symbol": "USDC" }\n',
            "  },\n",
            '  "uniswapV4": {\n',
            '    "routeId": "',
            vm.toString(d.routeId),
            '",\n',
            '    "currency0": "',
            vm.toString(Currency.unwrap(d.poolKey.currency0)),
            '",\n',
            '    "currency1": "',
            vm.toString(Currency.unwrap(d.poolKey.currency1)),
            '",\n',
            '    "fee": 8388608,\n',
            '    "tickSpacing": 60,\n',
            '    "hooks": "',
            vm.toString(address(d.poolKey.hooks)),
            '"\n',
            "  },\n"
        );

        string memory jsonPart3 = string.concat(
            '  "accounts": {\n',
            '    "deployer": "',
            vm.toString(DEPLOYER),
            '",\n',
            '    "lp": "',
            vm.toString(LP_PERSONA),
            '",\n',
            '    "taker": "',
            vm.toString(TAKER_PERSONA),
            '",\n',
            '    "feeVault": "',
            vm.toString(FEE_VAULT),
            '"\n',
            "  }\n",
            "}\n"
        );

        string memory fullJson = string.concat(jsonPart1, jsonPart2, jsonPart3);
        try vm.writeFile("local-anvil.json", fullJson) {
            console.log("Wrote local-anvil.json");
        } catch {
            console.log("Notice: Unable to write local-anvil.json");
        }
    }

    function exportEnv(LocalDeployment memory d) internal {
        string memory env1 = string.concat(
            "RPC_URL=http://127.0.0.1:8545\n",
            "CHAIN_ID=8453\n",
            "DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80\n",
            "LP_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d\n",
            "TAKER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a\n",
            "POOL_MANAGER=",
            vm.toString(address(d.poolManager)),
            "\n",
            "VENUE_ADAPTER=",
            vm.toString(address(d.venueAdapter)),
            "\n",
            "OPTION_HOOK=",
            vm.toString(address(d.hook)),
            "\n"
        );

        string memory env2 = string.concat(
            "V4_LIQUIDITY_VAULT=",
            vm.toString(address(d.vault)),
            "\n",
            "MOCK_SETTLEMENT_VENUE=",
            vm.toString(address(d.mockVenue)),
            "\n",
            "WETH=",
            vm.toString(address(d.weth)),
            "\n",
            "WBTC=",
            vm.toString(address(d.wbtc)),
            "\n",
            "USDC=",
            vm.toString(address(d.usdc)),
            "\n",
            "WETH_ORACLE=",
            vm.toString(address(d.wethOracle)),
            "\n",
            "WBTC_ORACLE=",
            vm.toString(address(d.wbtcOracle)),
            "\n",
            "ROUTE_ID=",
            vm.toString(d.routeId),
            "\n"
        );

        string memory fullEnv = string.concat(env1, env2);
        try vm.writeFile(".local.env", fullEnv) {
            console.log("Wrote .local.env");
        } catch {
            console.log("Notice: Unable to write .local.env");
        }
    }

    function exportAppEnv(LocalDeployment memory d) internal {
        string memory appEnv1 = string.concat(
            "NEXT_PUBLIC_BASE_RPC_URL=http://127.0.0.1:8545\n",
            "NEXT_PUBLIC_BASE_POOL_MANAGER=",
            vm.toString(address(d.poolManager)),
            "\n",
            "NEXT_PUBLIC_BASE_VENUE_ADAPTER=",
            vm.toString(address(d.venueAdapter)),
            "\n",
            "NEXT_PUBLIC_BASE_OPTION_HOOK=",
            vm.toString(address(d.hook)),
            "\n",
            "NEXT_PUBLIC_BASE_VAULT=",
            vm.toString(address(d.vault)),
            "\n"
        );

        string memory appEnv2 = string.concat(
            "NEXT_PUBLIC_BASE_WETH=",
            vm.toString(address(d.weth)),
            "\n",
            "NEXT_PUBLIC_BASE_WBTC=",
            vm.toString(address(d.wbtc)),
            "\n",
            "NEXT_PUBLIC_BASE_USDC=",
            vm.toString(address(d.usdc)),
            "\n",
            "NEXT_PUBLIC_BASE_CHAINLINK_ETH_USD=",
            vm.toString(address(d.wethOracle)),
            "\n",
            "NEXT_PUBLIC_BASE_MOCK_VENUE=",
            vm.toString(address(d.mockVenue)),
            "\n",
            "NEXT_PUBLIC_BASE_ROUTE_ID=",
            vm.toString(d.routeId),
            "\n"
        );

        string memory fullAppEnv = string.concat(appEnv1, appEnv2);
        try vm.writeFile("app/.env.local", fullAppEnv) {
            console.log("Wrote app/.env.local");
        } catch {
            console.log("Notice: Unable to write app/.env.local");
        }
    }
}
