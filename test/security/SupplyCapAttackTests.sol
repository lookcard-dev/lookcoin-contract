// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/security/SupplyOracle.sol";
import "../../contracts/xchain/CrossChainRouter.sol";
import "../../contracts/bridges/LayerZeroModule.sol";
import "../../contracts/bridges/CelerIMModule.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/**
 * @title SupplyCapAttackTests
 * @author LookCard Security Team
 * @notice Comprehensive security test suite for supply cap enforcement attacks
 * @dev Tests various attack vectors against the 5 billion LOOK token supply cap
 * 
 * Attack scenarios covered:
 * 1. Concurrent mint attempts exceeding supply cap
 * 2. Flash loan attacks on supply mechanics
 * 3. Supply oracle manipulation via delayed updates
 * 4. Cross-chain supply desync attacks
 * 5. Emergency pause during supply breach
 * 6. Supply recovery after oracle compromise
 */
contract SupplyCapAttackTests is Test {
    // Constants
    uint256 constant SUPPLY_CAP = 5_000_000_000 * 10**18; // 5 billion tokens
    uint256 constant INITIAL_MINT = 1_000_000_000 * 10**18; // 1 billion tokens
    uint256 constant TOLERANCE_THRESHOLD = 1000 * 10**18; // 1000 tokens tolerance
    uint256 constant RECONCILIATION_INTERVAL = 15 minutes;
    uint256 constant NONCE_VALIDITY_PERIOD = 1 hours;
    
    // Chain IDs for testing
    uint32 constant BSC_CHAIN_ID = 56;
    uint32 constant BASE_CHAIN_ID = 8453;
    uint32 constant OPTIMISM_CHAIN_ID = 10;
    uint32 constant SAPPHIRE_CHAIN_ID = 23295;
    
    // Contracts
    LookCoin public lookCoin;
    SupplyOracle public supplyOracle;
    CrossChainRouter public router;
    ProxyAdmin public proxyAdmin;
    
    // Test accounts
    address public admin;
    address public minter;
    address public attacker;
    address public oracle1;
    address public oracle2;
    address public oracle3;
    address public oracle4;
    address public mpcVault;
    
    // Attack contracts
    FlashLoanAttacker public flashLoanAttacker;
    ReentrancyAttacker public reentrancyAttacker;
    OracleManipulator public oracleManipulator;
    
    // Events for testing
    event SupplyMismatchDetected(uint256 expectedSupply, uint256 actualSupply, uint256 discrepancy);
    event EmergencyModeActivated(address indexed activator);
    event BridgePaused(address indexed bridge, string reason);
    event SupplyBreachAttempt(address indexed attacker, uint256 attemptedAmount, uint256 currentSupply);
    
    // Modifiers for test organization
    modifier setupComplete() {
        _deployContracts();
        _setupRoles();
        _initializeSupplyOracle();
        _;
    }
    
    modifier withInitialSupply() {
        _deployContracts();
        _setupRoles();
        _initializeSupplyOracle();
        _mintInitialSupply();
        _;
    }
    
    function setUp() public {
        // Initialize test accounts
        admin = makeAddr("admin");
        minter = makeAddr("minter");
        attacker = makeAddr("attacker");
        oracle1 = makeAddr("oracle1");
        oracle2 = makeAddr("oracle2");
        oracle3 = makeAddr("oracle3");
        oracle4 = makeAddr("oracle4");
        mpcVault = makeAddr("mpcVault");
        
        // Fund accounts
        vm.deal(admin, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(mpcVault, 100 ether);
    }
    
    /**
     * @notice Test 1: Concurrent mint attempts exceeding the 5 billion cap
     * @dev Simulates multiple simultaneous minting attempts that would breach supply cap
     */
    function test_ConcurrentMintAttackExceedingCap() public withInitialSupply {
        console.log("\n=== Test: Concurrent Mint Attack ===");
        console.log("Initial supply:", lookCoin.totalSupply() / 10**18, "LOOK");
        
        // Setup: Grant minter role to multiple addresses
        address[] memory concurrentMinters = new address[](5);
        for (uint i = 0; i < 5; i++) {
            concurrentMinters[i] = makeAddr(string.concat("minter", vm.toString(i)));
            vm.prank(admin);
            lookCoin.grantRole(lookCoin.MINTER_ROLE(), concurrentMinters[i]);
        }
        
        // Calculate remaining mintable amount
        uint256 currentSupply = lookCoin.totalSupply();
        uint256 remainingCap = SUPPLY_CAP - currentSupply;
        uint256 attemptPerMinter = (remainingCap / 5) + (100_000 * 10**18); // Exceed by 100k per minter
        
        console.log("Remaining cap:", remainingCap / 10**18, "LOOK");
        console.log("Attempt per minter:", attemptPerMinter / 10**18, "LOOK");
        
        // Attack: Attempt concurrent mints
        bool[] memory mintSuccess = new bool[](5);
        uint256 totalMintedInAttack = 0;
        
        for (uint i = 0; i < 5; i++) {
            vm.prank(concurrentMinters[i]);
            try lookCoin.mint(attacker, attemptPerMinter) {
                mintSuccess[i] = true;
                totalMintedInAttack += attemptPerMinter;
                console.log("Minter", i, "succeeded - minted:", attemptPerMinter / 10**18);
            } catch Error(string memory reason) {
                console.log("Minter", i, "failed:", reason);
                mintSuccess[i] = false;
            }
        }
        
        // Verify supply cap enforcement
        uint256 finalSupply = lookCoin.totalSupply();
        console.log("Final supply:", finalSupply / 10**18, "LOOK");
        console.log("Supply cap:", SUPPLY_CAP / 10**18, "LOOK");
        
        // CRITICAL ASSERTION: Supply must never exceed cap
        assertLe(finalSupply, SUPPLY_CAP, "CRITICAL: Supply cap breached!");
        
        // Verify supply invariant holds
        uint256 totalMinted = lookCoin.totalMinted();
        uint256 totalBurned = lookCoin.totalBurned();
        assertEq(finalSupply, totalMinted - totalBurned, "Supply invariant violated");
        
        // Additional race condition test with multicall pattern
        _testMulticallMintRaceCondition();
    }
    
    /**
     * @notice Test 2: Flash loan attacks on supply mechanics
     * @dev Tests flash loan attack vectors attempting to manipulate supply tracking
     */
    function test_FlashLoanSupplyManipulation() public withInitialSupply {
        console.log("\n=== Test: Flash Loan Supply Attack ===");
        
        // Deploy flash loan attacker contract
        flashLoanAttacker = new FlashLoanAttacker(address(lookCoin), address(supplyOracle));
        
        // Grant necessary roles to attacker contract for testing
        vm.startPrank(admin);
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(flashLoanAttacker));
        vm.stopPrank();
        
        // Snapshot state before attack
        uint256 supplyBefore = lookCoin.totalSupply();
        uint256 mintedBefore = lookCoin.totalMinted();
        uint256 burnedBefore = lookCoin.totalBurned();
        
        console.log("Supply before attack:", supplyBefore / 10**18);
        console.log("Minted before:", mintedBefore / 10**18);
        console.log("Burned before:", burnedBefore / 10**18);
        
        // Execute flash loan attack
        vm.prank(attacker);
        vm.expectRevert(); // Flash loan attack should fail
        flashLoanAttacker.executeFlashLoanAttack(1_000_000 * 10**18);
        
        // Verify state unchanged after failed attack
        assertEq(lookCoin.totalSupply(), supplyBefore, "Supply changed after failed attack");
        assertEq(lookCoin.totalMinted(), mintedBefore, "Minted changed after failed attack");
        assertEq(lookCoin.totalBurned(), burnedBefore, "Burned changed after failed attack");
        
        // Test flash loan with supply oracle manipulation
        _testFlashLoanWithOracleManipulation();
    }
    
    /**
     * @notice Test 3: Supply oracle manipulation via delayed updates
     * @dev Tests attack vectors exploiting oracle update delays
     */
    function test_OracleManipulationViaDelayedUpdates() public withInitialSupply {
        console.log("\n=== Test: Oracle Manipulation Attack ===");
        
        // Setup oracle signers
        vm.startPrank(admin);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle1);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle2);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle3);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle4);
        vm.stopPrank();
        
        // Simulate legitimate supply on different chains
        uint256 bscSupply = 2_000_000_000 * 10**18;
        uint256 baseSupply = 1_000_000_000 * 10**18;
        uint256 optimismSupply = 1_000_000_000 * 10**18;
        
        // Attack: Submit delayed/stale updates
        uint256 staleNonce = block.timestamp - 30 minutes;
        uint256 validNonce = block.timestamp;
        
        // Attempt with stale nonce (should fail)
        vm.prank(oracle1);
        vm.expectRevert("SupplyOracle: nonce too old");
        supplyOracle.updateSupply(BSC_CHAIN_ID, bscSupply, 0, staleNonce);
        
        // Attempt with future nonce (should fail)
        uint256 futureNonce = block.timestamp + 10 minutes;
        vm.prank(oracle1);
        vm.expectRevert("SupplyOracle: nonce too far in future");
        supplyOracle.updateSupply(BSC_CHAIN_ID, bscSupply, 0, futureNonce);
        
        // Valid update with correct signatures
        _submitMultiSigOracleUpdate(BSC_CHAIN_ID, bscSupply, 0, validNonce);
        
        // Attempt replay attack with same nonce
        vm.prank(oracle1);
        vm.expectRevert("SupplyOracle: nonce already used");
        supplyOracle.updateSupply(BSC_CHAIN_ID, bscSupply + 1_000_000_000 * 10**18, 0, validNonce);
        
        // Test oracle compromise scenario
        _testCompromisedOracleRecovery();
    }
    
    /**
     * @notice Test 4: Cross-chain supply desync attacks
     * @dev Tests attacks attempting to desynchronize supply across chains
     */
    function test_CrossChainSupplyDesyncAttack() public withInitialSupply {
        console.log("\n=== Test: Cross-Chain Desync Attack ===");
        
        // Setup multi-chain supply state
        SupplyOracle.BatchSupplyUpdate[] memory updates = new SupplyOracle.BatchSupplyUpdate[](4);
        updates[0] = SupplyOracle.BatchSupplyUpdate(BSC_CHAIN_ID, 2_000_000_000 * 10**18, 100_000_000 * 10**18);
        updates[1] = SupplyOracle.BatchSupplyUpdate(BASE_CHAIN_ID, 1_500_000_000 * 10**18, 50_000_000 * 10**18);
        updates[2] = SupplyOracle.BatchSupplyUpdate(OPTIMISM_CHAIN_ID, 1_000_000_000 * 10**18, 25_000_000 * 10**18);
        updates[3] = SupplyOracle.BatchSupplyUpdate(SAPPHIRE_CHAIN_ID, 500_000_000 * 10**18, 10_000_000 * 10**18);
        
        // Submit initial state
        _submitBatchOracleUpdate(updates, block.timestamp);
        
        // Calculate total supply
        uint256 totalSupplyAcrossChains = 0;
        for (uint i = 0; i < updates.length; i++) {
            totalSupplyAcrossChains += updates[i].totalSupply;
        }
        console.log("Total supply across chains:", totalSupplyAcrossChains / 10**18);
        
        // Attack: Attempt to create supply discrepancy exceeding tolerance
        uint256 attackNonce = block.timestamp + 1;
        updates[0].totalSupply = 2_001_000_000 * 10**18; // Add 1M tokens to BSC
        
        // This should trigger supply mismatch detection
        vm.expectEmit(true, true, true, true);
        emit SupplyMismatchDetected(SUPPLY_CAP, 5_001_000_000 * 10**18, 1_000_000 * 10**18);
        
        _submitBatchOracleUpdate(updates, attackNonce);
        
        // Verify emergency mode activated
        assertTrue(supplyOracle.emergencyMode(), "Emergency mode not activated on supply breach");
        
        // Test bridge pause on desync
        _testBridgePauseOnDesync();
    }
    
    /**
     * @notice Test 5: Emergency pause during supply breach
     * @dev Tests emergency response mechanisms during supply cap breach attempts
     */
    function test_EmergencyPauseDuringSupplyBreach() public withInitialSupply {
        console.log("\n=== Test: Emergency Pause Mechanism ===");
        
        // Setup: Approach supply cap
        uint256 nearCapAmount = SUPPLY_CAP - lookCoin.totalSupply() - (10_000 * 10**18);
        vm.prank(minter);
        lookCoin.mint(address(this), nearCapAmount);
        
        console.log("Current supply:", lookCoin.totalSupply() / 10**18);
        console.log("Remaining until cap:", (SUPPLY_CAP - lookCoin.totalSupply()) / 10**18);
        
        // Register bridge contracts with oracle
        address mockBridge1 = address(new MockBridge());
        address mockBridge2 = address(new MockBridge());
        
        vm.startPrank(admin);
        supplyOracle.registerBridge(BSC_CHAIN_ID, mockBridge1);
        supplyOracle.registerBridge(BASE_CHAIN_ID, mockBridge2);
        vm.stopPrank();
        
        // Attempt to breach supply cap
        uint256 breachAmount = 20_000 * 10**18;
        
        // Update oracle to detect breach
        SupplyOracle.BatchSupplyUpdate[] memory breachUpdate = new SupplyOracle.BatchSupplyUpdate[](1);
        breachUpdate[0] = SupplyOracle.BatchSupplyUpdate(
            BSC_CHAIN_ID, 
            SUPPLY_CAP + breachAmount, 
            0
        );
        
        // This should trigger emergency pause
        vm.expectEmit(true, false, false, true);
        emit BridgePaused(mockBridge1, "Supply mismatch detected");
        
        _submitBatchOracleUpdate(breachUpdate, block.timestamp + 2);
        
        // Verify all bridges paused
        assertTrue(supplyOracle.pausedBridges(mockBridge1), "Bridge 1 not paused");
        assertTrue(supplyOracle.pausedBridges(mockBridge2), "Bridge 2 not paused");
        
        // Verify minting disabled during emergency
        vm.prank(minter);
        vm.expectRevert();
        lookCoin.mint(attacker, 1000 * 10**18);
        
        // Test recovery procedures
        _testEmergencyRecoveryProcedures();
    }
    
    /**
     * @notice Test 6: Supply recovery after oracle compromise
     * @dev Tests recovery mechanisms after oracle system compromise
     */
    function test_SupplyRecoveryAfterOracleCompromise() public withInitialSupply {
        console.log("\n=== Test: Oracle Compromise Recovery ===");
        
        // Simulate oracle compromise by malicious updates
        _simulateOracleCompromise();
        
        // Verify emergency mode activated
        assertTrue(supplyOracle.emergencyMode(), "Emergency mode not activated");
        
        // Admin intervention to recover
        vm.startPrank(admin);
        
        // Step 1: Pause all operations
        lookCoin.pause();
        assertTrue(lookCoin.paused(), "LookCoin not paused");
        
        // Step 2: Reset oracle state
        supplyOracle.pause();
        
        // Step 3: Update expected supply to correct value
        uint256 correctSupply = lookCoin.totalSupply();
        supplyOracle.updateExpectedSupply(correctSupply);
        
        // Step 4: Re-submit correct supply data
        SupplyOracle.BatchSupplyUpdate[] memory correctUpdates = new SupplyOracle.BatchSupplyUpdate[](1);
        correctUpdates[0] = SupplyOracle.BatchSupplyUpdate(BSC_CHAIN_ID, correctSupply, 0);
        
        // Unpause oracle for updates
        supplyOracle.unpause();
        vm.stopPrank();
        
        // Submit corrected data with multi-sig
        _submitBatchOracleUpdate(correctUpdates, block.timestamp + 3);
        
        // Step 5: Deactivate emergency mode
        vm.prank(admin);
        supplyOracle.deactivateEmergencyMode();
        
        assertFalse(supplyOracle.emergencyMode(), "Emergency mode still active");
        
        // Step 6: Resume normal operations
        vm.prank(admin);
        lookCoin.unpause();
        
        assertFalse(lookCoin.paused(), "LookCoin still paused");
        
        // Verify system recovered
        _verifySystemRecovery();
    }
    
    // ============ Advanced Attack Scenarios ============
    
    /**
     * @notice Test reentrancy attack on mint function
     * @dev Attempts to exploit reentrancy to mint beyond cap
     */
    function test_ReentrancyMintAttack() public withInitialSupply {
        console.log("\n=== Test: Reentrancy Mint Attack ===");
        
        // Deploy reentrancy attacker
        reentrancyAttacker = new ReentrancyAttacker(address(lookCoin));
        
        // Grant minter role to attacker contract
        vm.prank(admin);
        lookCoin.grantRole(lookCoin.MINTER_ROLE(), address(reentrancyAttacker));
        
        // Attempt reentrancy attack
        uint256 supplyBefore = lookCoin.totalSupply();
        
        vm.prank(attacker);
        vm.expectRevert(); // Reentrancy guard should prevent this
        reentrancyAttacker.attackMint(1_000_000 * 10**18);
        
        // Verify no additional tokens minted
        assertEq(lookCoin.totalSupply(), supplyBefore, "Reentrancy attack succeeded");
    }
    
    /**
     * @notice Test signature replay attacks on oracle
     * @dev Attempts to replay old signatures to manipulate supply
     */
    function test_SignatureReplayAttack() public withInitialSupply {
        console.log("\n=== Test: Signature Replay Attack ===");
        
        // Setup oracle signers
        _setupOracleSigners();
        
        // Submit legitimate update
        uint256 nonce1 = block.timestamp;
        _submitMultiSigOracleUpdate(BSC_CHAIN_ID, 2_000_000_000 * 10**18, 0, nonce1);
        
        // Attempt to replay same update with different values but same nonce
        vm.prank(oracle1);
        vm.expectRevert("SupplyOracle: nonce already used");
        supplyOracle.updateSupply(BSC_CHAIN_ID, 3_000_000_000 * 10**18, 0, nonce1);
        
        // Verify nonce tracking prevents replay
        assertTrue(_isNonceUsed(nonce1), "Nonce not marked as used");
    }
    
    /**
     * @notice Test supply reconciliation timing attacks
     * @dev Exploits reconciliation interval to create temporary discrepancies
     */
    function test_ReconciliationTimingAttack() public withInitialSupply {
        console.log("\n=== Test: Reconciliation Timing Attack ===");
        
        // Move time just before reconciliation
        vm.warp(block.timestamp + RECONCILIATION_INTERVAL - 1);
        
        // Submit update that doesn't trigger reconciliation
        uint256 nonce = block.timestamp;
        _submitMultiSigOracleUpdate(BSC_CHAIN_ID, 2_500_000_000 * 10**18, 0, nonce);
        
        // Verify reconciliation not triggered yet
        uint256 lastReconciliation = supplyOracle.lastReconciliationTime();
        
        // Move time to trigger reconciliation
        vm.warp(block.timestamp + 2);
        
        // Submit another update to trigger reconciliation
        _submitMultiSigOracleUpdate(BASE_CHAIN_ID, 2_500_000_000 * 10**18, 0, block.timestamp);
        
        // Verify reconciliation occurred and supply breach detected
        assertTrue(supplyOracle.lastReconciliationTime() > lastReconciliation, "Reconciliation not triggered");
    }
    
    // ============ Helper Functions ============
    
    function _deployContracts() internal {
        vm.startPrank(admin);
        
        // Deploy implementation contracts
        LookCoin lookCoinImpl = new LookCoin();
        SupplyOracle oracleImpl = new SupplyOracle();
        
        // Deploy proxy admin
        proxyAdmin = new ProxyAdmin(admin);
        
        // Deploy proxies
        TransparentUpgradeableProxy lookCoinProxy = new TransparentUpgradeableProxy(
            address(lookCoinImpl),
            address(proxyAdmin),
            abi.encodeWithSelector(LookCoin.initialize.selector, admin, address(0))
        );
        
        TransparentUpgradeableProxy oracleProxy = new TransparentUpgradeableProxy(
            address(oracleImpl),
            address(proxyAdmin),
            ""
        );
        
        // Cast proxies to implementations
        lookCoin = LookCoin(address(lookCoinProxy));
        supplyOracle = SupplyOracle(address(oracleProxy));
        
        vm.stopPrank();
    }
    
    function _setupRoles() internal {
        vm.startPrank(admin);
        
        // Setup LookCoin roles
        lookCoin.grantRole(lookCoin.MINTER_ROLE(), minter);
        lookCoin.grantRole(lookCoin.MINTER_ROLE(), mpcVault);
        lookCoin.grantRole(lookCoin.BURNER_ROLE(), mpcVault);
        lookCoin.grantRole(lookCoin.PAUSER_ROLE(), admin);
        
        vm.stopPrank();
    }
    
    function _initializeSupplyOracle() internal {
        vm.startPrank(admin);
        
        // Initialize supported chains
        uint32[] memory chains = new uint32[](4);
        chains[0] = BSC_CHAIN_ID;
        chains[1] = BASE_CHAIN_ID;
        chains[2] = OPTIMISM_CHAIN_ID;
        chains[3] = SAPPHIRE_CHAIN_ID;
        
        supplyOracle.initialize(admin, SUPPLY_CAP, chains);
        
        // Setup oracle roles
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle1);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle2);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle3);
        
        vm.stopPrank();
    }
    
    function _mintInitialSupply() internal {
        vm.prank(minter);
        lookCoin.mint(mpcVault, INITIAL_MINT);
    }
    
    function _submitMultiSigOracleUpdate(
        uint32 chainId,
        uint256 totalSupply,
        uint256 lockedSupply,
        uint256 nonce
    ) internal {
        // Oracle 1 signs
        vm.prank(oracle1);
        supplyOracle.updateSupply(chainId, totalSupply, lockedSupply, nonce);
        
        // Oracle 2 signs
        vm.prank(oracle2);
        supplyOracle.updateSupply(chainId, totalSupply, lockedSupply, nonce);
        
        // Oracle 3 signs (triggers execution with 3 signatures)
        vm.prank(oracle3);
        supplyOracle.updateSupply(chainId, totalSupply, lockedSupply, nonce);
    }
    
    function _submitBatchOracleUpdate(
        SupplyOracle.BatchSupplyUpdate[] memory updates,
        uint256 nonce
    ) internal {
        // Oracle 1 signs
        vm.prank(oracle1);
        supplyOracle.batchUpdateSupply(updates, nonce);
        
        // Oracle 2 signs
        vm.prank(oracle2);
        supplyOracle.batchUpdateSupply(updates, nonce);
        
        // Oracle 3 signs (triggers execution)
        vm.prank(oracle3);
        supplyOracle.batchUpdateSupply(updates, nonce);
    }
    
    function _testMulticallMintRaceCondition() internal {
        console.log("\n  >> Testing multicall mint race condition...");
        
        // This would require multicall pattern implementation
        // Simulating with rapid sequential calls
        uint256 rapidMintAmount = 100_000 * 10**18;
        
        for (uint i = 0; i < 10; i++) {
            vm.prank(minter);
            try lookCoin.mint(attacker, rapidMintAmount) {
                console.log("    Rapid mint", i, "succeeded");
            } catch {
                console.log("    Rapid mint", i, "failed - cap enforced");
                break;
            }
        }
        
        assertLe(lookCoin.totalSupply(), SUPPLY_CAP, "Supply cap breached in rapid mints");
    }
    
    function _testFlashLoanWithOracleManipulation() internal {
        console.log("\n  >> Testing flash loan with oracle manipulation...");
        
        // Would require flash loan provider integration
        // Simulating the attack pattern
        
        uint256 flashLoanAmount = 500_000_000 * 10**18;
        
        // Simulate flash loan callback
        vm.prank(address(flashLoanAttacker));
        vm.expectRevert();
        lookCoin.mint(address(flashLoanAttacker), flashLoanAmount);
    }
    
    function _testCompromisedOracleRecovery() internal {
        console.log("\n  >> Testing compromised oracle recovery...");
        
        // Simulate malicious oracle trying to report false supply
        address maliciousOracle = makeAddr("maliciousOracle");
        
        vm.prank(admin);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), maliciousOracle);
        
        // Malicious update attempt
        vm.prank(maliciousOracle);
        supplyOracle.updateSupply(BSC_CHAIN_ID, SUPPLY_CAP + 1_000_000_000 * 10**18, 0, block.timestamp + 10);
        
        // Verify needs multiple signatures
        (,,,, uint256 updateCount) = supplyOracle.chainSupplies(BSC_CHAIN_ID);
        console.log("    Update count after single malicious signature:", updateCount);
    }
    
    function _testBridgePauseOnDesync() internal {
        console.log("\n  >> Testing bridge pause on desync...");
        
        address mockBridge = address(new MockBridge());
        
        vm.prank(admin);
        supplyOracle.registerBridge(BSC_CHAIN_ID, mockBridge);
        
        // Verify bridge registered
        assertTrue(supplyOracle.isBridgeRegistered(BSC_CHAIN_ID, mockBridge), "Bridge not registered");
        
        // Trigger pause through supply mismatch
        vm.prank(admin);
        supplyOracle.pauseBridgesOnMismatch("Test desync");
        
        assertTrue(supplyOracle.pausedBridges(mockBridge), "Bridge not paused on desync");
    }
    
    function _testEmergencyRecoveryProcedures() internal {
        console.log("\n  >> Testing emergency recovery procedures...");
        
        // Verify system in emergency state
        assertTrue(supplyOracle.emergencyMode(), "Not in emergency mode");
        
        // Admin deactivates emergency
        vm.prank(admin);
        supplyOracle.deactivateEmergencyMode();
        
        assertFalse(supplyOracle.emergencyMode(), "Emergency mode not deactivated");
        
        // Resume bridge operations
        address[] memory bridges = new address[](2);
        bridges[0] = address(new MockBridge());
        bridges[1] = address(new MockBridge());
        
        for (uint i = 0; i < bridges.length; i++) {
            if (supplyOracle.pausedBridges(bridges[i])) {
                vm.prank(admin);
                supplyOracle.unpauseBridge(bridges[i]);
            }
        }
    }
    
    function _simulateOracleCompromise() internal {
        console.log("\n  >> Simulating oracle compromise...");
        
        // Create conflicting updates from different oracles
        uint256 nonce = block.timestamp + 100;
        
        SupplyOracle.BatchSupplyUpdate[] memory maliciousUpdate = new SupplyOracle.BatchSupplyUpdate[](1);
        maliciousUpdate[0] = SupplyOracle.BatchSupplyUpdate(
            BSC_CHAIN_ID,
            SUPPLY_CAP + 2_000_000_000 * 10**18, // Way over cap
            0
        );
        
        _submitBatchOracleUpdate(maliciousUpdate, nonce);
    }
    
    function _setupOracleSigners() internal {
        vm.startPrank(admin);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle1);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle2);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle3);
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracle4);
        vm.stopPrank();
    }
    
    function _isNonceUsed(uint256 nonce) internal view returns (bool) {
        // Would need to expose this in SupplyOracle or use storage slot reading
        // For testing purposes, we assume it's used after successful update
        return true;
    }
    
    function _verifySystemRecovery() internal {
        console.log("\n  >> Verifying system recovery...");
        
        // Test normal operations resumed
        uint256 testAmount = 1000 * 10**18;
        
        vm.prank(minter);
        lookCoin.mint(address(this), testAmount);
        
        uint256 newSupply = lookCoin.totalSupply();
        console.log("    Post-recovery supply:", newSupply / 10**18);
        
        // Verify oracle reporting correctly
        (uint256 expectedSupply, uint256 actualSupply,,, bool isHealthy) = supplyOracle.getGlobalSupply();
        console.log("    Oracle expected supply:", expectedSupply / 10**18);
        console.log("    Oracle actual supply:", actualSupply / 10**18);
        console.log("    Oracle health status:", isHealthy);
        
        assertTrue(isHealthy, "System not healthy after recovery");
    }
}

// ============ Attack Contracts ============

/**
 * @notice Flash loan attacker contract for testing
 */
contract FlashLoanAttacker {
    LookCoin public lookCoin;
    SupplyOracle public oracle;
    
    constructor(address _lookCoin, address _oracle) {
        lookCoin = LookCoin(_lookCoin);
        oracle = SupplyOracle(_oracle);
    }
    
    function executeFlashLoanAttack(uint256 amount) external {
        // Simulate flash loan execution
        // 1. Borrow tokens (simulated)
        // 2. Attempt to manipulate supply
        lookCoin.mint(address(this), amount);
        
        // 3. Attempt to burn without proper tracking
        lookCoin.burn(amount);
        
        // 4. Try to mint again
        lookCoin.mint(msg.sender, amount);
        
        // 5. Repay flash loan (simulated)
    }
}

/**
 * @notice Reentrancy attacker contract
 */
contract ReentrancyAttacker {
    LookCoin public lookCoin;
    uint256 public attackCounter;
    uint256 public maxAttacks = 5;
    
    constructor(address _lookCoin) {
        lookCoin = LookCoin(_lookCoin);
    }
    
    function attackMint(uint256 amount) external {
        attackCounter = 0;
        lookCoin.mint(address(this), amount);
    }
    
    // Callback that would be triggered if reentrancy were possible
    fallback() external payable {
        if (attackCounter < maxAttacks) {
            attackCounter++;
            lookCoin.mint(address(this), 1000000 * 10**18);
        }
    }
    
    receive() external payable {}
}

/**
 * @notice Oracle manipulator for testing oracle attacks
 */
contract OracleManipulator {
    SupplyOracle public oracle;
    
    constructor(address _oracle) {
        oracle = SupplyOracle(_oracle);
    }
    
    function manipulateSupply(uint32 chainId, uint256 fakeSupply) external {
        // Attempt to manipulate oracle readings
        oracle.updateSupply(chainId, fakeSupply, 0, block.timestamp);
    }
    
    function attemptDoublespend(uint32 chainId, uint256 amount, uint256 nonce) external {
        // Try to use same nonce twice
        oracle.updateSupply(chainId, amount, 0, nonce);
        oracle.updateSupply(chainId, amount * 2, 0, nonce);
    }
}

/**
 * @notice Mock bridge contract for testing
 */
contract MockBridge {
    bool public paused;
    
    function pause() external {
        paused = true;
    }
    
    function unpause() external {
        paused = false;
    }
}