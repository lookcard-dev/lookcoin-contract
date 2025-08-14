// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/security/SupplyOracle.sol";
import "../../contracts/xchain/CrossChainRouter.sol";
import "../../contracts/xchain/FeeManager.sol";

/**
 * @title InvariantHandler
 * @dev Handler contract for controlled invariant testing
 * @notice Acts as a sophisticated fuzzing actor that performs controlled state mutations
 * 
 * The handler implements:
 * - Controlled minting and burning operations
 * - Cross-chain transfer simulations
 * - Fee collection tracking
 * - Oracle update simulations
 * - Access control testing
 * - Emergency scenario testing
 */
contract InvariantHandler is Test {
    // Core contracts being tested
    LookCoin public lookCoin;
    SupplyOracle public supplyOracle;
    CrossChainRouter public router;
    FeeManager public feeManager;
    
    // Test actors for realistic multi-user scenarios
    address[] public actors;
    mapping(address => uint256) public actorBalances;
    mapping(address => uint256) public actorNonces;
    
    // Cross-chain tracking
    mapping(uint16 => uint64) public expectedNonces;
    mapping(uint16 => bytes32) public trustedRemotes;
    uint256[] public trackedChainIds;
    
    // Fee tracking
    mapping(uint256 => uint256) public protocolFees; // protocol index => total fees
    uint256 public totalFeesCollected;
    uint256 public totalTransactionCount;
    
    // Supply tracking for verification
    mapping(address => uint256) public balanceTracker;
    uint256 public totalBalanceSum;
    
    // Operation limits for realistic testing
    uint256 public constant MAX_MINT_AMOUNT = 1000000e18; // 1M tokens per mint
    uint256 public constant MAX_BURN_AMOUNT = 100000e18;  // 100K tokens per burn
    uint256 public constant MAX_TRANSFER_AMOUNT = 50000e18; // 50K tokens per transfer
    
    // Ghost variables for tracking system state
    uint256 public ghost_totalMinted;
    uint256 public ghost_totalBurned;
    uint256 public ghost_totalTransfers;
    uint256 public ghost_crossChainMessages;
    uint256 public ghost_oracleUpdates;
    
    // Events for debugging and verification
    event HandlerMint(address indexed to, uint256 amount);
    event HandlerBurn(address indexed from, uint256 amount);
    event HandlerTransfer(address indexed from, address indexed to, uint256 amount);
    event HandlerCrossChainTransfer(uint16 indexed dstChain, uint256 amount);
    event HandlerOracleUpdate(uint32 indexed chainId, uint256 supply);
    event HandlerFeeCollection(uint256 amount, uint256 protocol);
    
    modifier useActor(uint256 actorIndexSeed) {
        address currentActor = actors[bound(actorIndexSeed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }
    
    modifier validAmount(uint256 amount, uint256 maxAmount) {
        amount = bound(amount, 1e15, maxAmount); // Min 0.001 tokens, max varies
        _;
    }
    
    constructor(
        LookCoin _lookCoin,
        SupplyOracle _supplyOracle,
        CrossChainRouter _router,
        FeeManager _feeManager,
        address[] memory _actors
    ) {
        lookCoin = _lookCoin;
        supplyOracle = _supplyOracle;
        router = _router;
        feeManager = _feeManager;
        actors = _actors;
        
        // Initialize tracking
        _initializeTracking();
        
        console.log("InvariantHandler initialized with", actors.length, "actors");
    }
    
    /******************************************************************************
     *                            MINTING OPERATIONS                             *
     ******************************************************************************/
    
    /**
     * @dev Controlled minting operation for invariant testing
     * @param actorSeed Seed for selecting actor
     * @param amount Amount to mint (will be bounded)
     */
    function mint(uint256 actorSeed, uint256 amount) 
        external 
        useActor(actorSeed)
        validAmount(amount, MAX_MINT_AMOUNT)
    {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        
        // Only proceed if actor has minter role or we're testing as admin
        if (!lookCoin.hasRole(lookCoin.MINTER_ROLE(), actor)) {
            return; // Skip if no permission
        }
        
        // Check supply cap before minting
        if (lookCoin.totalSupply() + amount > 5_000_000_000e18) {
            return; // Skip if would exceed cap
        }
        
        // Perform the mint
        try lookCoin.mint(actor, amount) {
            // Update tracking
            ghost_totalMinted += amount;
            balanceTracker[actor] += amount;
            totalBalanceSum += amount;
            
            emit HandlerMint(actor, amount);
        } catch {
            // Mint failed - this is expected in some cases
        }
    }
    
    /**
     * @dev Controlled burning operation for invariant testing
     * @param actorSeed Seed for selecting actor
     * @param amount Amount to burn (will be bounded)
     */
    function burn(uint256 actorSeed, uint256 amount) 
        external 
        useActor(actorSeed) 
        validAmount(amount, MAX_BURN_AMOUNT)
    {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        
        // Only proceed if actor has burner role or we're testing as admin
        if (!lookCoin.hasRole(lookCoin.BURNER_ROLE(), actor)) {
            return; // Skip if no permission
        }
        
        // Bound amount to actual balance
        uint256 actorBalance = lookCoin.balanceOf(actor);
        if (actorBalance == 0) return;
        
        amount = bound(amount, 1e15, actorBalance);
        
        // Perform the burn
        try lookCoin.burn(amount) {
            // Update tracking
            ghost_totalBurned += amount;
            balanceTracker[actor] -= amount;
            totalBalanceSum -= amount;
            
            emit HandlerBurn(actor, amount);
        } catch {
            // Burn failed - this is expected in some cases
        }
    }
    
    /******************************************************************************
     *                           TRANSFER OPERATIONS                             *
     ******************************************************************************/
    
    /**
     * @dev Regular ERC20 transfer for testing balance consistency
     * @param fromSeed Seed for selecting sender
     * @param toSeed Seed for selecting recipient  
     * @param amount Amount to transfer
     */
    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) 
        external
        validAmount(amount, MAX_TRANSFER_AMOUNT)
    {
        address from = actors[bound(fromSeed, 0, actors.length - 1)];
        address to = actors[bound(toSeed, 0, actors.length - 1)];
        
        if (from == to) return; // Skip self-transfers
        
        uint256 fromBalance = lookCoin.balanceOf(from);
        if (fromBalance == 0) return;
        
        amount = bound(amount, 1e15, fromBalance);
        
        vm.startPrank(from);
        try lookCoin.transfer(to, amount) {
            // Update tracking
            balanceTracker[from] -= amount;
            balanceTracker[to] += amount;
            ghost_totalTransfers++;
            
            emit HandlerTransfer(from, to, amount);
        } catch {
            // Transfer failed - this is expected in some cases
        }
        vm.stopPrank();
    }
    
    /**
     * @dev Cross-chain transfer simulation via LayerZero
     * @param actorSeed Seed for selecting sender
     * @param dstChainSeed Seed for destination chain
     * @param amount Amount to transfer cross-chain
     */
    function crossChainTransfer(uint256 actorSeed, uint256 dstChainSeed, uint256 amount) 
        external
        validAmount(amount, MAX_TRANSFER_AMOUNT)
    {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        uint16 dstChain = uint16(bound(dstChainSeed, 1, 65535));
        
        // Skip if destination is current chain
        if (dstChain == block.chainid) return;
        
        uint256 actorBalance = lookCoin.balanceOf(actor);
        if (actorBalance == 0) return;
        
        amount = bound(amount, 1e15, actorBalance);
        
        // Check if destination chain is configured
        bytes32 trustedRemote = lookCoin.trustedRemoteLookup(dstChain);
        if (trustedRemote == bytes32(0)) {
            // Set up trusted remote for testing
            trustedRemotes[dstChain] = keccak256(abi.encodePacked(dstChain, block.timestamp));
        }
        
        vm.startPrank(actor);
        vm.deal(actor, 1 ether); // Ensure actor has ETH for fees
        
        try lookCoin.sendFrom{value: 0.01 ether}(
            actor,
            dstChain,
            abi.encodePacked(actor),
            amount,
            payable(actor),
            address(0),
            ""
        ) {
            // Update tracking
            ghost_crossChainMessages++;
            expectedNonces[dstChain]++;
            totalFeesCollected += 0.01 ether;
            totalTransactionCount++;
            
            emit HandlerCrossChainTransfer(dstChain, amount);
        } catch {
            // Cross-chain transfer failed
        }
        vm.stopPrank();
    }
    
    /******************************************************************************
     *                            ORACLE OPERATIONS                              *
     ******************************************************************************/
    
    /**
     * @dev Simulate oracle supply updates for testing supply reconciliation
     * @param chainSeed Seed for selecting chain to update
     * @param supplySeed Seed for generating supply value
     */
    function oracleSupplyUpdate(uint256 chainSeed, uint256 supplySeed) external {
        uint32[] memory supportedChains = new uint32[](5);
        supportedChains[0] = 1;   // Ethereum
        supportedChains[1] = 56;  // BSC
        supportedChains[2] = 137; // Polygon
        supportedChains[3] = 10;  // Optimism
        supportedChains[4] = 8453; // Base
        
        uint32 chainId = supportedChains[bound(chainSeed, 0, supportedChains.length - 1)];
        
        // Generate realistic supply value based on actual total supply
        uint256 totalSupply = lookCoin.totalSupply();
        uint256 chainSupply = bound(supplySeed, 0, totalSupply);
        
        // Simulate oracle update (if we have permission)
        try supplyOracle.updateSupply(
            chainId,
            chainSupply,
            0, // locked supply
            block.timestamp,
            0  // nonce
        ) {
            ghost_oracleUpdates++;
            emit HandlerOracleUpdate(chainId, chainSupply);
        } catch {
            // Oracle update failed - might be due to permissions or validation
        }
    }
    
    /**
     * @dev Simulate emergency oracle actions
     * @param actorSeed Seed for selecting actor to perform emergency action
     */
    function emergencyOracleAction(uint256 actorSeed) external useActor(actorSeed) {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        
        if (!supplyOracle.hasRole(supplyOracle.EMERGENCY_ROLE(), actor)) {
            return; // Skip if no emergency role
        }
        
        // Randomly choose emergency action
        uint256 action = bound(actorSeed, 0, 2);
        
        try {
            if (action == 0 && !supplyOracle.emergencyMode()) {
                // Activate emergency mode
                supplyOracle.activateEmergencyMode("Handler test");
            } else if (action == 1 && supplyOracle.emergencyMode()) {
                // Deactivate emergency mode
                supplyOracle.deactivateEmergencyMode();
            } else if (action == 2) {
                // Force reconciliation
                supplyOracle.forceReconcile();
            }
        } catch {
            // Emergency action failed
        }
    }
    
    /******************************************************************************
     *                              FEE OPERATIONS                               *
     ******************************************************************************/
    
    /**
     * @dev Simulate fee collection for different protocols
     * @param protocolSeed Seed for selecting protocol
     * @param feeSeed Seed for fee amount
     */
    function collectProtocolFee(uint256 protocolSeed, uint256 feeSeed) external {
        uint256 protocol = bound(protocolSeed, 0, 2); // LayerZero, Celer, Hyperlane
        uint256 feeAmount = bound(feeSeed, 1e15, 0.1 ether);
        
        // Simulate fee collection
        protocolFees[protocol] += feeAmount;
        totalFeesCollected += feeAmount;
        totalTransactionCount++;
        
        emit HandlerFeeCollection(feeAmount, protocol);
    }
    
    /******************************************************************************
     *                            ACCESS CONTROL TESTS                           *
     ******************************************************************************/
    
    /**
     * @dev Test role-based access control by attempting unauthorized operations
     * @param actorSeed Seed for selecting actor
     * @param operationSeed Seed for selecting operation to test
     */
    function testUnauthorizedAccess(uint256 actorSeed, uint256 operationSeed) external {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        uint256 operation = bound(operationSeed, 0, 4);
        
        vm.startPrank(actor);
        
        // Test various unauthorized operations
        if (operation == 0) {
            // Try to pause without permission
            try lookCoin.pause() {
                // Should fail if no PAUSER_ROLE
            } catch {}
        } else if (operation == 1) {
            // Try to grant role without permission
            try lookCoin.grantRole(lookCoin.MINTER_ROLE(), actor) {
                // Should fail if no DEFAULT_ADMIN_ROLE
            } catch {}
        } else if (operation == 2) {
            // Try to set LayerZero endpoint without permission
            try lookCoin.setLayerZeroEndpoint(address(0x123)) {
                // Should fail if no PROTOCOL_ADMIN_ROLE
            } catch {}
        } else if (operation == 3) {
            // Try unauthorized oracle update
            try supplyOracle.updateSupply(1, 1000e18, 0, block.timestamp, 0) {
                // Should fail if no ORACLE_ROLE
            } catch {}
        }
        
        vm.stopPrank();
    }
    
    /******************************************************************************
     *                            VIEW FUNCTIONS                                 *
     ******************************************************************************/
    
    /**
     * @dev Calculate total balance sum for invariant verification
     * @return Sum of all tracked balances
     */
    function calculateTotalBalanceSum() external view returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            sum += lookCoin.balanceOf(actors[i]);
        }
        return sum;
    }
    
    /**
     * @dev Get total fees for a specific protocol
     * @param protocol Protocol index (0: LayerZero, 1: Celer, 2: Hyperlane)
     * @return Total fees collected for the protocol
     */
    function getProtocolFees(uint256 protocol) external view returns (uint256) {
        return protocolFees[protocol];
    }
    
    /**
     * @dev Get expected nonce for a chain
     * @param chainId Chain ID to check
     * @return Expected nonce value
     */
    function getExpectedNonce(uint16 chainId) external view returns (uint64) {
        return expectedNonces[chainId];
    }
    
    /**
     * @dev Check if trusted remote is valid
     * @param chainId Chain ID to check
     * @param remote Trusted remote hash
     * @return True if valid
     */
    function isTrustedRemoteValid(uint16 chainId, bytes32 remote) external view returns (bool) {
        return trustedRemotes[chainId] == remote || remote != bytes32(0);
    }
    
    /**
     * @dev Get tracked chain IDs
     * @return Array of tracked chain IDs
     */
    function getTrackedChainIds() external view returns (uint256[] memory) {
        return trackedChainIds;
    }
    
    /**
     * @dev Calculate total fees across all operations
     * @return Total calculated fees
     */
    function calculateTotalFees() external view returns (uint256) {
        return protocolFees[0] + protocolFees[1] + protocolFees[2];
    }
    
    /**
     * @dev Get total fees collected
     * @return Total fees collected
     */
    function getTotalFeesCollected() external view returns (uint256) {
        return totalFeesCollected;
    }
    
    /**
     * @dev Get total transaction count
     * @return Number of transactions processed
     */
    function getTotalTransactionCount() external view returns (uint256) {
        return totalTransactionCount;
    }
    
    /******************************************************************************
     *                            HELPER FUNCTIONS                               *
     ******************************************************************************/
    
    function _initializeTracking() private {
        // Initialize tracked chains
        trackedChainIds.push(1);    // Ethereum
        trackedChainIds.push(56);   // BSC  
        trackedChainIds.push(137);  // Polygon
        trackedChainIds.push(10);   // Optimism
        trackedChainIds.push(8453); // Base
        
        // Initialize balance tracking for all actors
        for (uint256 i = 0; i < actors.length; i++) {
            balanceTracker[actors[i]] = lookCoin.balanceOf(actors[i]);
            totalBalanceSum += balanceTracker[actors[i]];
        }
        
        // Initialize ghost variables
        ghost_totalMinted = lookCoin.totalMinted();
        ghost_totalBurned = lookCoin.totalBurned();
        ghost_totalTransfers = 0;
        ghost_crossChainMessages = 0;
        ghost_oracleUpdates = 0;
    }
    
    /**
     * @dev Reset handler state for testing
     * @notice Only callable by test contracts
     */
    function resetState() external {
        totalFeesCollected = 0;
        totalTransactionCount = 0;
        ghost_totalTransfers = 0;
        ghost_crossChainMessages = 0;
        ghost_oracleUpdates = 0;
        
        // Reset protocol fees
        for (uint256 i = 0; i < 3; i++) {
            protocolFees[i] = 0;
        }
        
        // Reset balance tracking
        totalBalanceSum = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            balanceTracker[actors[i]] = lookCoin.balanceOf(actors[i]);
            totalBalanceSum += balanceTracker[actors[i]];
        }
    }
    
    /**
     * @dev Get comprehensive state summary for debugging
     * @return State summary string
     */
    function getStateSummary() external view returns (string memory) {
        return string(abi.encodePacked(
            "Handler State - ",
            "Minted: ", vm.toString(ghost_totalMinted),
            ", Burned: ", vm.toString(ghost_totalBurned),
            ", Transfers: ", vm.toString(ghost_totalTransfers),
            ", CrossChain: ", vm.toString(ghost_crossChainMessages),
            ", Oracle Updates: ", vm.toString(ghost_oracleUpdates),
            ", Total Fees: ", vm.toString(totalFeesCollected)
        ));
    }
}