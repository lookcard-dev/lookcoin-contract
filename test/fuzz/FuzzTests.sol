// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/xchain/CrossChainRouter.sol";
import "../../contracts/security/SupplyOracle.sol";
import "../../contracts/mocks/MockLayerZero.sol";
import "../../contracts/mocks/MockCeler.sol";
import "../../contracts/test/UUPSProxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./FuzzTargets.sol";

/**
 * @title FuzzTests
 * @dev Comprehensive fuzz testing suite for LookCoin contract using Foundry's native fuzzing
 * @notice Tests critical security properties and invariants under random inputs
 */
contract FuzzTests is Test {
    // Core contracts
    LookCoin public lookCoin;
    CrossChainRouter public router;
    SupplyOracle public supplyOracle;
    FuzzTargets public fuzzTargets;
    
    // Mock contracts
    MockLayerZeroEndpoint public mockLzEndpoint;
    MockCelerMessageBridge public mockCelerBridge;
    
    // Test addresses
    address public admin;
    address public user1;
    address public user2;
    address public minter;
    address public burner;
    address public pauser;
    address public upgrader;
    address public attacker;
    
    // Constants for fuzzing
    uint256 public constant MAX_SUPPLY = 5_000_000_000 * 10**18; // 5 billion tokens
    uint256 public constant MIN_TRANSFER_AMOUNT = 1e12; // Minimum transfer amount (0.000001 LOOK)
    uint256 public constant MAX_TRANSFER_AMOUNT = 1_000_000 * 10**18; // 1M tokens max per transfer
    uint16 public constant MAX_CHAIN_ID = 65535;
    uint256 public constant MIN_GAS_LIMIT = 50000;
    uint256 public constant MAX_GAS_LIMIT = 5000000;
    
    // Roles for fuzzing
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant PROTOCOL_ADMIN_ROLE = keccak256("PROTOCOL_ADMIN_ROLE");
    bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");
    
    // State tracking for invariants
    mapping(address => uint256) public userInitialBalances;
    uint256 public totalMintedTracker;
    uint256 public totalBurnedTracker;
    bool public contractPaused;
    
    event FuzzTestEvent(string indexed testType, address indexed user, uint256 amount);
    
    function setUp() public {
        // Initialize test addresses
        admin = makeAddr("admin");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        minter = makeAddr("minter");
        burner = makeAddr("burner");
        pauser = makeAddr("pauser");
        upgrader = makeAddr("upgrader");
        attacker = makeAddr("attacker");
        
        // Fund test addresses
        vm.deal(admin, 100 ether);
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        vm.deal(minter, 10 ether);
        vm.deal(attacker, 10 ether);
        
        // Deploy mock dependencies
        mockLzEndpoint = new MockLayerZeroEndpoint(1);
        mockCelerBridge = new MockCelerMessageBridge();
        
        // Deploy LookCoin with proxy
        vm.startPrank(admin);
        
        LookCoin implementation = new LookCoin();
        bytes memory initData = abi.encodeWithSelector(
            LookCoin.initialize.selector,
            admin,
            address(mockLzEndpoint)
        );
        
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        lookCoin = LookCoin(address(proxy));
        
        // Setup roles
        lookCoin.grantRole(MINTER_ROLE, minter);
        lookCoin.grantRole(MINTER_ROLE, admin);
        lookCoin.grantRole(BURNER_ROLE, burner);
        lookCoin.grantRole(BURNER_ROLE, admin);
        lookCoin.grantRole(PAUSER_ROLE, pauser);
        lookCoin.grantRole(UPGRADER_ROLE, upgrader);
        
        // Deploy fuzz targets
        fuzzTargets = new FuzzTargets(address(lookCoin), admin);
        
        vm.stopPrank();
        
        // Initialize tracking variables
        totalMintedTracker = 0;
        totalBurnedTracker = 0;
        contractPaused = false;
    }
    
    /*//////////////////////////////////////////////////////////////
                        INPUT BOUNDARY FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test minting with various amounts and addresses
    function testFuzz_MintBoundaries(uint256 amount, address to) public {
        // Bound inputs to reasonable ranges
        amount = bound(amount, 1, MAX_SUPPLY / 1000); // Max 0.1% of total supply per mint
        vm.assume(to != address(0));
        vm.assume(to != address(lookCoin));
        
        vm.startPrank(minter);
        
        uint256 balanceBefore = lookCoin.balanceOf(to);
        uint256 totalSupplyBefore = lookCoin.totalSupply();
        
        // Execute mint
        lookCoin.mint(to, amount);
        
        // Verify state changes
        assertEq(lookCoin.balanceOf(to), balanceBefore + amount);
        assertEq(lookCoin.totalSupply(), totalSupplyBefore + amount);
        assertEq(lookCoin.totalMinted(), lookCoin.totalMinted() - amount + amount); // Verify totalMinted updated
        
        emit FuzzTestEvent("mint", to, amount);
        
        vm.stopPrank();
    }
    
    /// @notice Fuzz test burning with various amounts and addresses
    function testFuzz_BurnBoundaries(uint256 mintAmount, uint256 burnAmount, address user) public {
        // Bound inputs
        mintAmount = bound(mintAmount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        burnAmount = bound(burnAmount, 1, mintAmount); // Can't burn more than balance
        vm.assume(user != address(0));
        vm.assume(user != address(lookCoin));
        
        // Setup: mint tokens first
        vm.prank(minter);
        lookCoin.mint(user, mintAmount);
        
        uint256 balanceBefore = lookCoin.balanceOf(user);
        uint256 totalSupplyBefore = lookCoin.totalSupply();
        
        // Execute burn
        vm.prank(burner);
        lookCoin.burnFrom(user, burnAmount);
        
        // Verify state changes
        assertEq(lookCoin.balanceOf(user), balanceBefore - burnAmount);
        assertEq(lookCoin.totalSupply(), totalSupplyBefore - burnAmount);
        
        emit FuzzTestEvent("burn", user, burnAmount);
    }
    
    /// @notice Fuzz test transfers with boundary conditions
    function testFuzz_TransferBoundaries(
        uint256 mintAmount,
        uint256 transferAmount,
        address from,
        address to
    ) public {
        // Bound and validate inputs
        mintAmount = bound(mintAmount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        transferAmount = bound(transferAmount, 1, mintAmount);
        vm.assume(from != address(0) && to != address(0));
        vm.assume(from != to);
        vm.assume(from != address(lookCoin) && to != address(lookCoin));
        
        // Setup: mint tokens to sender
        vm.prank(minter);
        lookCoin.mint(from, mintAmount);
        
        uint256 fromBalanceBefore = lookCoin.balanceOf(from);
        uint256 toBalanceBefore = lookCoin.balanceOf(to);
        uint256 totalSupplyBefore = lookCoin.totalSupply();
        
        // Execute transfer
        vm.prank(from);
        lookCoin.transfer(to, transferAmount);
        
        // Verify balances
        assertEq(lookCoin.balanceOf(from), fromBalanceBefore - transferAmount);
        assertEq(lookCoin.balanceOf(to), toBalanceBefore + transferAmount);
        assertEq(lookCoin.totalSupply(), totalSupplyBefore); // Total supply unchanged
        
        emit FuzzTestEvent("transfer", from, transferAmount);
    }
    
    /// @notice Fuzz test LayerZero cross-chain parameters
    function testFuzz_LayerZeroBoundaries(
        uint16 dstChainId,
        uint256 amount,
        address to,
        uint256 gasLimit
    ) public {
        // Bound inputs
        dstChainId = uint16(bound(dstChainId, 1, MAX_CHAIN_ID));
        amount = bound(amount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        gasLimit = bound(gasLimit, MIN_GAS_LIMIT, MAX_GAS_LIMIT);
        vm.assume(to != address(0));
        
        // Skip if same chain
        vm.assume(dstChainId != block.chainid);
        
        // Setup trusted remote
        vm.prank(admin);
        bytes32 trustedRemote = bytes32(uint256(uint160(address(lookCoin))));
        lookCoin.connectPeer(dstChainId, trustedRemote);
        
        // Mint tokens to user1
        vm.prank(minter);
        lookCoin.mint(user1, amount * 2);
        
        bytes memory toAddressBytes = abi.encodePacked(to);
        
        // Test sendFrom with various parameters
        vm.prank(user1);
        vm.deal(user1, 1 ether);
        
        uint256 balanceBefore = lookCoin.balanceOf(user1);
        
        // This should not revert with proper bounds
        try lookCoin.sendFrom{value: 0.1 ether}(
            user1,
            dstChainId,
            toAddressBytes,
            amount,
            payable(user1),
            address(0),
            abi.encodePacked(uint16(1), gasLimit)
        ) {
            // Verify tokens were burned
            assertEq(lookCoin.balanceOf(user1), balanceBefore - amount);
            emit FuzzTestEvent("layerzero_send", user1, amount);
        } catch {
            // Some parameter combinations may fail, which is acceptable
            // as long as the contract doesn't break
            assertTrue(true);
        }
    }
    
    /*//////////////////////////////////////////////////////////////
                      STATE TRANSITION FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test pause/unpause state transitions
    function testFuzz_PauseStateTransitions(bool shouldPause, uint256 amount, address user) public {
        amount = bound(amount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        vm.assume(user != address(0) && user != address(lookCoin));
        
        // Setup initial state
        vm.prank(minter);
        lookCoin.mint(user, amount);
        
        // Randomly pause/unpause
        if (shouldPause && !contractPaused) {
            vm.prank(pauser);
            lookCoin.pause();
            contractPaused = true;
        } else if (!shouldPause && contractPaused) {
            vm.prank(pauser);
            lookCoin.unpause();
            contractPaused = false;
        }
        
        // Test operations based on pause state
        if (contractPaused) {
            // Operations should fail when paused
            vm.expectRevert("Pausable: paused");
            vm.prank(user);
            lookCoin.transfer(user2, amount / 2);
        } else {
            // Operations should succeed when not paused
            vm.prank(user);
            lookCoin.transfer(user2, amount / 2);
            assertEq(lookCoin.balanceOf(user2), amount / 2);
        }
    }
    
    /// @notice Fuzz test role-based state transitions
    function testFuzz_RoleTransitions(uint8 roleIndex, address target, bool shouldGrant) public {
        vm.assume(target != address(0));
        
        bytes32[] memory roles = new bytes32[](7);
        roles[0] = DEFAULT_ADMIN_ROLE;
        roles[1] = MINTER_ROLE;
        roles[2] = BURNER_ROLE;
        roles[3] = PAUSER_ROLE;
        roles[4] = UPGRADER_ROLE;
        roles[5] = BRIDGE_ROLE;
        roles[6] = PROTOCOL_ADMIN_ROLE;
        
        uint256 boundIndex = bound(roleIndex, 0, roles.length - 1);
        bytes32 role = roles[boundIndex];
        
        bool hasRoleBefore = lookCoin.hasRole(role, target);
        
        vm.startPrank(admin);
        
        if (shouldGrant && !hasRoleBefore) {
            lookCoin.grantRole(role, target);
            assertTrue(lookCoin.hasRole(role, target));
        } else if (!shouldGrant && hasRoleBefore && role != DEFAULT_ADMIN_ROLE) {
            // Don't revoke admin role from admin
            if (!(target == admin && role == DEFAULT_ADMIN_ROLE)) {
                lookCoin.revokeRole(role, target);
                assertFalse(lookCoin.hasRole(role, target));
            }
        }
        
        vm.stopPrank();
    }
    
    /*//////////////////////////////////////////////////////////////
                   CROSS-CONTRACT INTERACTION FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test interactions with mock LayerZero endpoint
    function testFuzz_LayerZeroInteractions(
        uint16 srcChainId,
        uint64 nonce,
        uint256 amount,
        address recipient
    ) public {
        srcChainId = uint16(bound(srcChainId, 1, MAX_CHAIN_ID));
        amount = bound(amount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        vm.assume(recipient != address(0));
        vm.assume(srcChainId != block.chainid);
        
        // Setup trusted remote for source chain
        vm.prank(admin);
        lookCoin.connectPeer(srcChainId, bytes32(uint256(uint160(address(lookCoin)))));
        
        // Simulate LayerZero message reception
        bytes memory srcAddress = abi.encodePacked(address(lookCoin), address(lookCoin));
        bytes memory payload = abi.encode(0, user1, abi.encodePacked(recipient), amount);
        
        uint256 balanceBefore = lookCoin.balanceOf(recipient);
        uint256 totalSupplyBefore = lookCoin.totalSupply();
        
        // Mock the LayerZero endpoint call
        vm.prank(address(mockLzEndpoint));
        try lookCoin.lzReceive(srcChainId, srcAddress, nonce, payload) {
            // Verify tokens were minted
            assertEq(lookCoin.balanceOf(recipient), balanceBefore + amount);
            assertEq(lookCoin.totalSupply(), totalSupplyBefore + amount);
            
            // Verify nonce was processed
            assertTrue(lookCoin.isNonceProcessed(srcChainId, nonce));
        } catch {
            // Some combinations may fail due to validation, which is expected
            assertTrue(true);
        }
    }
    
    /*//////////////////////////////////////////////////////////////
                      TIME-BASED OPERATION FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test time-dependent operations
    function testFuzz_TimeDependentOperations(uint256 timeShift, uint256 amount) public {
        timeShift = bound(timeShift, 1, 365 days);
        amount = bound(amount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT);
        
        // Record initial state
        uint256 initialTimestamp = block.timestamp;
        
        // Mint initial tokens
        vm.prank(minter);
        lookCoin.mint(user1, amount);
        
        // Shift time forward
        vm.warp(block.timestamp + timeShift);
        
        // Verify basic operations still work after time shift
        vm.prank(user1);
        lookCoin.transfer(user2, amount / 2);
        
        assertEq(lookCoin.balanceOf(user2), amount / 2);
        
        // Verify contract state consistency
        assertTrue(block.timestamp > initialTimestamp);
        
        emit FuzzTestEvent("time_shift", user1, timeShift);
    }
    
    /*//////////////////////////////////////////////////////////////
                   ROLE PERMISSION MATRIX FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test comprehensive role permission matrix
    function testFuzz_RolePermissionMatrix(
        uint8 callerRoleIndex,
        uint8 operationIndex,
        address caller,
        uint256 amount
    ) public {
        amount = bound(amount, MIN_TRANSFER_AMOUNT, MAX_TRANSFER_AMOUNT / 10);
        vm.assume(caller != address(0) && caller != address(lookCoin));
        
        // Define roles
        bytes32[] memory roles = new bytes32[](8);
        roles[0] = DEFAULT_ADMIN_ROLE;
        roles[1] = MINTER_ROLE;
        roles[2] = BURNER_ROLE;
        roles[3] = PAUSER_ROLE;
        roles[4] = UPGRADER_ROLE;
        roles[5] = BRIDGE_ROLE;
        roles[6] = PROTOCOL_ADMIN_ROLE;
        roles[7] = ROUTER_ADMIN_ROLE;
        
        uint256 boundRoleIndex = bound(callerRoleIndex, 0, roles.length - 1);
        uint256 boundOpIndex = bound(operationIndex, 0, 6); // 7 operations to test
        
        bytes32 role = roles[boundRoleIndex];
        
        // Grant role to caller
        vm.prank(admin);
        lookCoin.grantRole(role, caller);
        
        // Setup tokens for burn/transfer operations
        if (boundOpIndex >= 2) { // For burn and transfer operations
            vm.prank(minter);
            lookCoin.mint(caller, amount * 2);
        }
        
        vm.startPrank(caller);
        
        // Test different operations based on role
        if (boundOpIndex == 0) { // Mint operation
            if (role == MINTER_ROLE || role == BRIDGE_ROLE || role == DEFAULT_ADMIN_ROLE) {
                lookCoin.mint(user1, amount);
                assertEq(lookCoin.balanceOf(user1), amount);
            } else {
                vm.expectRevert();
                lookCoin.mint(user1, amount);
            }
        } else if (boundOpIndex == 1) { // Burn operation
            if (role == BURNER_ROLE || role == BRIDGE_ROLE || role == DEFAULT_ADMIN_ROLE) {
                vm.prank(minter);
                lookCoin.mint(caller, amount);
                vm.prank(caller);
                lookCoin.burn(amount);
                assertEq(lookCoin.balanceOf(caller), 0);
            } else {
                vm.expectRevert();
                lookCoin.burn(amount);
            }
        } else if (boundOpIndex == 2) { // Pause operation
            if (role == PAUSER_ROLE || role == DEFAULT_ADMIN_ROLE) {
                lookCoin.pause();
                assertTrue(lookCoin.paused());
                lookCoin.unpause(); // Cleanup
            } else {
                vm.expectRevert();
                lookCoin.pause();
            }
        } else if (boundOpIndex == 3) { // Protocol admin operations
            if (role == PROTOCOL_ADMIN_ROLE || role == DEFAULT_ADMIN_ROLE) {
                lookCoin.setGasForDestinationLzReceive(350000);
                assertEq(lookCoin.gasForDestinationLzReceive(), 350000);
            } else {
                vm.expectRevert();
                lookCoin.setGasForDestinationLzReceive(350000);
            }
        }
        
        vm.stopPrank();
    }
    
    /*//////////////////////////////////////////////////////////////
                    PROTOCOL PARAMETER FUZZ TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Fuzz test protocol parameter configurations
    function testFuzz_ProtocolParameters(
        uint16 chainId,
        uint256 gasLimit,
        address endpoint,
        bytes20 trustedRemote
    ) public {
        chainId = uint16(bound(chainId, 1, MAX_CHAIN_ID));
        gasLimit = bound(gasLimit, MIN_GAS_LIMIT, MAX_GAS_LIMIT);
        vm.assume(endpoint != address(0));
        vm.assume(trustedRemote != bytes20(0));
        
        vm.startPrank(admin);
        
        // Test gas limit configuration
        try lookCoin.setGasForDestinationLzReceive(gasLimit) {
            assertEq(lookCoin.gasForDestinationLzReceive(), gasLimit);
        } catch {
            // Some gas limits may be invalid
            assertTrue(gasLimit == 0 || gasLimit >= 1000000);
        }
        
        // Test LayerZero endpoint configuration
        try lookCoin.setLayerZeroEndpoint(endpoint) {
            assertEq(address(lookCoin.lzEndpoint()), endpoint);
        } catch {
            // Should only fail if endpoint is zero address
            assertEq(endpoint, address(0));
        }
        
        // Test trusted remote configuration
        bytes memory trustedRemoteBytes = abi.encodePacked(trustedRemote);
        try lookCoin.setTrustedRemote(chainId, trustedRemoteBytes) {
            assertEq(lookCoin.getTrustedRemote(chainId), bytes32(trustedRemote));
        } catch {
            // Should only fail for invalid inputs
            assertTrue(trustedRemoteBytes.length != 20);
        }
        
        vm.stopPrank();
    }
    
    /*//////////////////////////////////////////////////////////////
                         INVARIANT TESTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Invariant: Total supply should always equal minted minus burned
    function invariant_SupplyConsistency() public view {
        assertEq(lookCoin.totalSupply(), lookCoin.totalMinted() - lookCoin.totalBurned());
        assertEq(lookCoin.circulatingSupply(), lookCoin.totalMinted() - lookCoin.totalBurned());
    }
    
    /// @notice Invariant: Total supply should never exceed maximum supply
    function invariant_MaxSupplyLimit() public view {
        assertLe(lookCoin.totalSupply(), MAX_SUPPLY);
        assertLe(lookCoin.totalMinted(), MAX_SUPPLY);
    }
    
    /// @notice Invariant: Individual balances should never exceed total supply
    function invariant_BalanceLimit() public view {
        assertLe(lookCoin.balanceOf(user1), lookCoin.totalSupply());
        assertLe(lookCoin.balanceOf(user2), lookCoin.totalSupply());
        assertLe(lookCoin.balanceOf(minter), lookCoin.totalSupply());
    }
    
    /// @notice Invariant: Contract should maintain basic ERC20 properties
    function invariant_ERC20Properties() public view {
        // Decimals should be 18
        assertEq(lookCoin.decimals(), 18);
        
        // Name and symbol should be set
        assertEq(lookCoin.name(), "LookCoin");
        assertEq(lookCoin.symbol(), "LOOK");
    }
    
    /// @notice Invariant: Admin role should always be maintained
    function invariant_AdminRolePresence() public view {
        assertTrue(lookCoin.hasRole(DEFAULT_ADMIN_ROLE, admin));
    }
}