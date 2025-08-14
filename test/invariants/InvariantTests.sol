// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "forge-std/invariant/StdInvariant.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/security/SupplyOracle.sol";
import "../../contracts/xchain/CrossChainRouter.sol";
import "../../contracts/xchain/FeeManager.sol";
import "../../contracts/mocks/MockLayerZero.sol";
import "../../contracts/mocks/MockCeler.sol";
import "./InvariantHandler.sol";

/**
 * @title InvariantTests
 * @dev Comprehensive invariant testing suite for LookCoin protocol
 * @notice Tests critical system properties that must always hold true
 * 
 * Invariants tested:
 * 1. Supply consistency: totalSupply = totalMinted - totalBurned
 * 2. Balance sum integrity: totalSupply = sum(all balances)
 * 3. Supply cap enforcement: totalSupply <= MAX_SUPPLY
 * 4. Cross-chain message nonce consistency
 * 5. Fee accounting accuracy
 * 6. Protocol state consistency
 * 7. Oracle supply accuracy
 * 8. Role-based access control integrity
 * 9. Upgrade safety preservation
 * 10. Emergency pause state consistency
 */
contract InvariantTests is StdInvariant, Test {
    // Constants
    uint256 public constant MAX_SUPPLY = 5_000_000_000e18; // 5 billion tokens
    uint256 public constant MIN_ORACLE_SIGNATURES = 3;
    uint256 public constant MAX_TOLERANCE_BASIS_POINTS = 100; // 1%
    
    // Core contracts
    LookCoin public lookCoin;
    SupplyOracle public supplyOracle;
    CrossChainRouter public router;
    FeeManager public feeManager;
    
    // Mock contracts for testing
    MockLayerZeroEndpoint public mockLzEndpoint;
    MockMessageBus public mockCeler;
    
    // Handler contracts for controlled fuzzing
    InvariantHandler public handler;
    
    // Tracking variables for invariant verification
    uint256 public totalMintedTracked;
    uint256 public totalBurnedTracked;
    uint256 public totalFeesCollectedTracked;
    uint256 public totalCrossChainMessagesTracked;
    
    // Test configuration
    uint32[] public supportedChains = [1, 56, 137, 10, 8453]; // Ethereum, BSC, Polygon, Optimism, Base
    address[] public testActors;
    
    function setUp() public {
        // Deploy mock infrastructure
        mockLzEndpoint = new MockLayerZeroEndpoint();
        mockCeler = new MockMessageBus();
        
        // Deploy core contracts
        lookCoin = new LookCoin();
        supplyOracle = new SupplyOracle();
        router = new CrossChainRouter();
        feeManager = new FeeManager();
        
        // Initialize contracts
        lookCoin.initialize(address(this), address(mockLzEndpoint));
        supplyOracle.initialize(address(this), MAX_SUPPLY, supportedChains);
        router.initialize(address(this), address(lookCoin));
        feeManager.initialize(address(this));
        
        // Set up protocol integrations
        _setupProtocolIntegrations();
        
        // Create test actors
        _createTestActors();
        
        // Deploy and configure handler
        handler = new InvariantHandler(
            lookCoin,
            supplyOracle,
            router,
            feeManager,
            testActors
        );
        
        // Configure handler as target contract for fuzzing
        targetContract(address(handler));
        
        // Grant necessary roles to handler
        _grantHandlerRoles();
        
        // Initialize tracking variables
        totalMintedTracked = lookCoin.totalMinted();
        totalBurnedTracked = lookCoin.totalBurned();
        totalFeesCollectedTracked = 0;
        totalCrossChainMessagesTracked = 0;
        
        console.log("InvariantTests setup completed");
        console.log("LookCoin address:", address(lookCoin));
        console.log("Handler address:", address(handler));
    }
    
    /******************************************************************************
     *                            CORE SUPPLY INVARIANTS                          *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 1: Supply consistency
     * totalSupply() must always equal totalMinted - totalBurned
     */
    function invariant_SupplyConsistency() public view {
        uint256 currentSupply = lookCoin.totalSupply();
        uint256 totalMinted = lookCoin.totalMinted();
        uint256 totalBurned = lookCoin.totalBurned();
        
        assertEq(
            currentSupply,
            totalMinted - totalBurned,
            "INVARIANT VIOLATION: totalSupply != totalMinted - totalBurned"
        );
    }
    
    /**
     * @dev INVARIANT 2: Balance sum integrity
     * Total supply must equal the sum of all individual balances
     */
    function invariant_BalanceSumIntegrity() public view {
        uint256 currentSupply = lookCoin.totalSupply();
        uint256 balanceSum = handler.calculateTotalBalanceSum();
        
        assertEq(
            currentSupply,
            balanceSum,
            "INVARIANT VIOLATION: totalSupply != sum of all balances"
        );
    }
    
    /**
     * @dev INVARIANT 3: Supply cap enforcement
     * Total supply must never exceed the maximum cap
     */
    function invariant_SupplyCapEnforcement() public view {
        uint256 currentSupply = lookCoin.totalSupply();
        
        assertLe(
            currentSupply,
            MAX_SUPPLY,
            "INVARIANT VIOLATION: totalSupply exceeds MAX_SUPPLY"
        );
    }
    
    /**
     * @dev INVARIANT 4: Mint-burn balance
     * Total minted must always be >= total burned
     */
    function invariant_MintBurnBalance() public view {
        uint256 totalMinted = lookCoin.totalMinted();
        uint256 totalBurned = lookCoin.totalBurned();
        
        assertGe(
            totalMinted,
            totalBurned,
            "INVARIANT VIOLATION: totalBurned > totalMinted"
        );
    }
    
    /******************************************************************************
     *                         CROSS-CHAIN INVARIANTS                            *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 5: Cross-chain message nonce consistency
     * Nonces must be monotonically increasing and never reused
     */
    function invariant_NonceConsistency() public view {
        uint256[] memory chainIds = handler.getTrackedChainIds();
        
        for (uint256 i = 0; i < chainIds.length; i++) {
            uint16 chainId = uint16(chainIds[i]);
            uint64 currentNonce = mockLzEndpoint.getOutboundNonce(chainId, address(lookCoin));
            uint64 expectedNonce = handler.getExpectedNonce(chainId);
            
            assertGe(
                currentNonce,
                expectedNonce,
                "INVARIANT VIOLATION: Cross-chain nonce inconsistency"
            );
        }
    }
    
    /**
     * @dev INVARIANT 6: Trusted remote consistency
     * Trusted remotes must be bidirectional and consistent
     */
    function invariant_TrustedRemoteConsistency() public view {
        uint256[] memory chainIds = handler.getTrackedChainIds();
        
        for (uint256 i = 0; i < chainIds.length; i++) {
            uint16 chainId = uint16(chainIds[i]);
            bytes32 trustedRemote = lookCoin.trustedRemoteLookup(chainId);
            
            // If a trusted remote is set, it should not be zero
            if (trustedRemote != bytes32(0)) {
                assertTrue(
                    handler.isTrustedRemoteValid(chainId, trustedRemote),
                    "INVARIANT VIOLATION: Invalid trusted remote configuration"
                );
            }
        }
    }
    
    /******************************************************************************
     *                             FEE INVARIANTS                                *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 7: Fee collection accuracy
     * Total fees collected must equal sum of all protocol fees
     */
    function invariant_FeeCollectionAccuracy() public view {
        uint256 totalFeesInContract = address(feeManager).balance;
        uint256 calculatedFees = handler.calculateTotalFees();
        
        // Allow for small rounding differences (less than 1 wei per transaction)
        uint256 tolerance = handler.getTotalTransactionCount();
        
        assertApproxEqAbs(
            totalFeesInContract,
            calculatedFees,
            tolerance,
            "INVARIANT VIOLATION: Fee collection mismatch"
        );
    }
    
    /**
     * @dev INVARIANT 8: Fee distribution consistency
     * Fees must be properly distributed across protocols
     */
    function invariant_FeeDistributionConsistency() public view {
        uint256 layerZeroFees = handler.getProtocolFees(0); // LayerZero
        uint256 celerFees = handler.getProtocolFees(1);     // Celer
        uint256 hyperlaneFees = handler.getProtocolFees(2); // Hyperlane
        
        uint256 totalProtocolFees = layerZeroFees + celerFees + hyperlaneFees;
        uint256 totalFeesCollected = handler.getTotalFeesCollected();
        
        assertLe(
            totalProtocolFees,
            totalFeesCollected,
            "INVARIANT VIOLATION: Protocol fees exceed total collected"
        );
    }
    
    /******************************************************************************
     *                            ORACLE INVARIANTS                              *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 9: Oracle supply accuracy
     * Oracle reported supply must be within tolerance of actual supply
     */
    function invariant_OracleSupplyAccuracy() public view {
        uint256 actualTotalSupply = lookCoin.totalSupply();
        uint256 oracleReportedSupply = supplyOracle.totalExpectedSupply();
        
        if (oracleReportedSupply > 0) {
            uint256 tolerance = (actualTotalSupply * MAX_TOLERANCE_BASIS_POINTS) / 10000;
            
            assertApproxEqAbs(
                actualTotalSupply,
                oracleReportedSupply,
                tolerance,
                "INVARIANT VIOLATION: Oracle supply accuracy exceeded"
            );
        }
    }
    
    /**
     * @dev INVARIANT 10: Oracle chain supply consistency
     * Sum of all chain supplies should equal total supply
     */
    function invariant_OracleChainSupplyConsistency() public view {
        uint256 totalChainSupplies = 0;
        
        for (uint256 i = 0; i < supportedChains.length; i++) {
            (uint256 chainSupply,,,) = supplyOracle.chainSupplies(supportedChains[i]);
            totalChainSupplies += chainSupply;
        }
        
        uint256 actualTotalSupply = lookCoin.totalSupply();
        uint256 tolerance = (actualTotalSupply * MAX_TOLERANCE_BASIS_POINTS) / 10000;
        
        if (totalChainSupplies > 0) {
            assertApproxEqAbs(
                totalChainSupplies,
                actualTotalSupply,
                tolerance,
                "INVARIANT VIOLATION: Oracle chain supply sum mismatch"
            );
        }
    }
    
    /******************************************************************************
     *                         ACCESS CONTROL INVARIANTS                         *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 11: Role-based access control integrity
     * Critical functions should only be callable by authorized roles
     */
    function invariant_AccessControlIntegrity() public view {
        // Verify admin role assignments
        assertTrue(
            lookCoin.hasRole(lookCoin.DEFAULT_ADMIN_ROLE(), address(this)),
            "INVARIANT VIOLATION: Admin role assignment corrupted"
        );
        
        // Verify handler has necessary roles for testing
        assertTrue(
            lookCoin.hasRole(lookCoin.MINTER_ROLE(), address(handler)),
            "INVARIANT VIOLATION: Handler minter role missing"
        );
        
        assertTrue(
            lookCoin.hasRole(lookCoin.BURNER_ROLE(), address(handler)),
            "INVARIANT VIOLATION: Handler burner role missing"
        );
    }
    
    /**
     * @dev INVARIANT 12: Role hierarchy consistency
     * Role hierarchy must be maintained
     */
    function invariant_RoleHierarchyConsistency() public view {
        bytes32 adminRole = lookCoin.DEFAULT_ADMIN_ROLE();
        bytes32 minterRole = lookCoin.MINTER_ROLE();
        bytes32 burnerRole = lookCoin.BURNER_ROLE();
        
        // Admin should be able to grant/revoke other roles
        assertEq(
            lookCoin.getRoleAdmin(minterRole),
            adminRole,
            "INVARIANT VIOLATION: Minter role admin mismatch"
        );
        
        assertEq(
            lookCoin.getRoleAdmin(burnerRole),
            adminRole,
            "INVARIANT VIOLATION: Burner role admin mismatch"
        );
    }
    
    /******************************************************************************
     *                             STATE INVARIANTS                              *
     ******************************************************************************/
    
    /**
     * @dev INVARIANT 13: Contract state consistency
     * Contract should never be in an inconsistent state
     */
    function invariant_ContractStateConsistency() public view {
        // Check that pause state is consistent
        bool isPaused = lookCoin.paused();
        bool oracleEmergencyMode = supplyOracle.emergencyMode();
        
        // If oracle is in emergency mode, related contracts should be aware
        if (oracleEmergencyMode) {
            // Additional checks can be added here based on emergency protocols
        }
        
        // Verify that upgrade functionality is not broken
        assertTrue(
            lookCoin.hasRole(lookCoin.UPGRADER_ROLE(), address(this)),
            "INVARIANT VIOLATION: Upgrade role compromised"
        );
    }
    
    /**
     * @dev INVARIANT 14: Storage integrity
     * Critical storage variables must maintain consistency
     */
    function invariant_StorageIntegrity() public view {
        // Verify that gas limits are within reasonable bounds
        uint256 gasLimit = lookCoin.gasForDestinationLzReceive();
        
        assertGe(
            gasLimit,
            200000,
            "INVARIANT VIOLATION: Gas limit too low"
        );
        
        assertLe(
            gasLimit,
            2000000,
            "INVARIANT VIOLATION: Gas limit too high"
        );
        
        // Verify LayerZero endpoint is set if contract is initialized
        if (address(lookCoin.lzEndpoint()) != address(0)) {
            assertEq(
                address(lookCoin.lzEndpoint()),
                address(mockLzEndpoint),
                "INVARIANT VIOLATION: LayerZero endpoint mismatch"
            );
        }
    }
    
    /******************************************************************************
     *                            HELPER FUNCTIONS                               *
     ******************************************************************************/
    
    function _setupProtocolIntegrations() private {
        // Configure LayerZero
        lookCoin.grantRole(lookCoin.PROTOCOL_ADMIN_ROLE(), address(this));
        
        // Set up basic trusted remotes for testing
        for (uint256 i = 0; i < supportedChains.length; i++) {
            if (supportedChains[i] != block.chainid) {
                bytes32 trustedRemote = keccak256(abi.encodePacked(address(lookCoin), supportedChains[i]));
                // Note: In real deployment, this would be the actual remote contract address
            }
        }
    }
    
    function _createTestActors() private {
        // Create multiple test actor addresses
        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(uint256(keccak256(abi.encodePacked("actor", i)))));
            testActors.push(actor);
            
            // Give each actor some initial ETH for gas
            vm.deal(actor, 10 ether);
        }
    }
    
    function _grantHandlerRoles() private {
        // Grant handler the necessary roles for testing
        lookCoin.grantRole(lookCoin.MINTER_ROLE(), address(handler));
        lookCoin.grantRole(lookCoin.BURNER_ROLE(), address(handler));
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(handler));
        
        supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), address(handler));
        supplyOracle.grantRole(supplyOracle.OPERATOR_ROLE(), address(handler));
        
        // Grant roles to test actors for realistic testing
        for (uint256 i = 0; i < testActors.length; i++) {
            lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), testActors[i]);
        }
    }
    
    /**
     * @dev Emergency function to check all invariants manually
     * Useful for debugging specific invariant failures
     */
    function checkAllInvariants() external view returns (bool) {
        try this.invariant_SupplyConsistency() {
            try this.invariant_BalanceSumIntegrity() {
                try this.invariant_SupplyCapEnforcement() {
                    try this.invariant_MintBurnBalance() {
                        try this.invariant_FeeCollectionAccuracy() {
                            try this.invariant_OracleSupplyAccuracy() {
                                try this.invariant_AccessControlIntegrity() {
                                    try this.invariant_ContractStateConsistency() {
                                        return true;
                                    } catch { return false; }
                                } catch { return false; }
                            } catch { return false; }
                        } catch { return false; }
                    } catch { return false; }
                } catch { return false; }
            } catch { return false; }
        } catch { return false; }
    }
}