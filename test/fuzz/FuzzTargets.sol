// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/interfaces/ICrossChainRouter.sol";

/**
 * @title FuzzTargets
 * @dev Specialized contract for targeted fuzzing of specific LookCoin functions and scenarios
 * @notice Provides focused testing of critical security properties and edge cases
 */
contract FuzzTargets is Test {
    LookCoin public lookCoin;
    address public admin;
    
    // Fuzzing constants
    uint256 public constant MAX_FUZZ_SUPPLY = 1_000_000 * 10**18; // 1M tokens for fuzzing
    uint256 public constant MIN_FUZZ_AMOUNT = 1;
    uint256 public constant MAX_FUZZ_AMOUNT = 100_000 * 10**18; // 100K tokens
    uint16 public constant MAX_FUZZ_CHAIN_ID = 1000;
    
    // Events for fuzzing analysis
    event FuzzTargetHit(string target, bytes32 inputHash, bool success);
    event SecurityPropertyViolated(string property, bytes data);
    event EdgeCaseDetected(string scenario, bytes32 signature);
    
    constructor(address _lookCoin, address _admin) {
        lookCoin = LookCoin(_lookCoin);
        admin = _admin;
    }
    
    /*//////////////////////////////////////////////////////////////
                        CRITICAL FUNCTION TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing of mint function with extreme values
    function fuzzTarget_MintExtremes(
        address to,
        uint256 amount,
        bool useMaxSupply,
        bytes32 salt
    ) external {
        // Generate deterministic but varied inputs
        amount = useMaxSupply ? type(uint256).max : amount % MAX_FUZZ_SUPPLY;
        address target = to == address(0) ? address(uint160(uint256(salt))) : to;
        
        if (target == address(0) || target == address(lookCoin)) {
            target = address(uint160(uint256(salt) | 1)); // Ensure non-zero
        }
        
        bytes32 inputHash = keccak256(abi.encodePacked(target, amount, salt));
        
        vm.startPrank(admin);
        
        try lookCoin.mint(target, amount) {
            emit FuzzTargetHit("mint_extreme", inputHash, true);
            
            // Check for potential overflow conditions
            if (lookCoin.totalSupply() < lookCoin.totalMinted()) {
                emit SecurityPropertyViolated("supply_overflow", abi.encodePacked(amount));
            }
        } catch (bytes memory reason) {
            emit FuzzTargetHit("mint_extreme", inputHash, false);
            
            // Log specific failure reasons for analysis
            if (keccak256(reason) == keccak256("LookCoin: mint to zero address")) {
                emit EdgeCaseDetected("mint_zero_address", inputHash);
            }
        }
        
        vm.stopPrank();
    }
    
    /// @notice Targeted fuzzing of burn function with edge cases
    function fuzzTarget_BurnEdgeCases(
        address from,
        uint256 burnAmount,
        uint256 balance,
        bool selfBurn
    ) external {
        balance = balance % MAX_FUZZ_SUPPLY;
        burnAmount = burnAmount % (balance + 1); // Ensure burnAmount <= balance
        
        address target = from == address(0) ? admin : from;
        
        // Setup: mint tokens first
        vm.prank(admin);
        lookCoin.mint(target, balance);
        
        bytes32 inputHash = keccak256(abi.encodePacked(target, burnAmount, balance, selfBurn));
        
        address caller = selfBurn ? target : admin;
        vm.startPrank(caller);
        
        try lookCoin.burnFrom(target, burnAmount) {
            emit FuzzTargetHit("burn_edge", inputHash, true);
            
            // Verify burn didn't create negative balance
            if (lookCoin.balanceOf(target) > balance) {
                emit SecurityPropertyViolated("negative_balance", abi.encodePacked(target, burnAmount));
            }
        } catch (bytes memory reason) {
            emit FuzzTargetHit("burn_edge", inputHash, false);
            
            if (keccak256(reason) == keccak256("ERC20: burn amount exceeds balance")) {
                emit EdgeCaseDetected("burn_exceeds_balance", inputHash);
            }
        }
        
        vm.stopPrank();
    }
    
    /// @notice Targeted fuzzing of LayerZero sendFrom with malformed data
    function fuzzTarget_LayerZeroMalformed(
        uint16 dstChainId,
        bytes calldata toAddress,
        uint256 amount,
        bytes calldata adapterParams,
        uint256 msgValue
    ) external {
        dstChainId = uint16(bound(dstChainId, 1, MAX_FUZZ_CHAIN_ID));
        amount = bound(amount, MIN_FUZZ_AMOUNT, MAX_FUZZ_AMOUNT);
        msgValue = bound(msgValue, 0, 10 ether);
        
        // Setup trusted remote
        vm.prank(admin);
        lookCoin.connectPeer(dstChainId, bytes32(uint256(uint160(address(lookCoin)))));
        
        // Mint tokens
        vm.prank(admin);
        lookCoin.mint(admin, amount);
        
        bytes32 inputHash = keccak256(abi.encodePacked(dstChainId, toAddress, amount, adapterParams));
        
        vm.startPrank(admin);
        vm.deal(admin, msgValue);
        
        try lookCoin.sendFrom{value: msgValue}(
            admin,
            dstChainId,
            toAddress,
            amount,
            payable(admin),
            address(0),
            adapterParams
        ) {
            emit FuzzTargetHit("layerzero_malformed", inputHash, true);
        } catch (bytes memory reason) {
            emit FuzzTargetHit("layerzero_malformed", inputHash, false);
            
            // Analyze specific failure patterns
            if (bytes4(reason) == bytes4(keccak256("LookCoin: invalid recipient"))) {
                emit EdgeCaseDetected("invalid_recipient", inputHash);
            } else if (bytes4(reason) == bytes4(keccak256("LookCoin: invalid amount"))) {
                emit EdgeCaseDetected("invalid_amount", inputHash);
            }
        }
        
        vm.stopPrank();
    }
    
    /*//////////////////////////////////////////////////////////////
                        REENTRANCY TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing for reentrancy vulnerabilities
    function fuzzTarget_ReentrancyAttempts(
        uint256 amount,
        uint8 attackType,
        address attacker
    ) external {
        amount = bound(amount, MIN_FUZZ_AMOUNT, MAX_FUZZ_AMOUNT);
        attackType = uint8(bound(attackType, 0, 3)); // 4 different attack types
        
        vm.assume(attacker != address(0) && attacker != address(lookCoin));
        
        // Deploy reentrancy attacker contract
        ReentrancyAttacker attackContract = new ReentrancyAttacker(address(lookCoin));
        
        // Mint tokens to attacker
        vm.prank(admin);
        lookCoin.mint(address(attackContract), amount);
        
        bytes32 inputHash = keccak256(abi.encodePacked(amount, attackType, attacker));
        
        try attackContract.attemptReentrancy(attackType, amount) {
            emit FuzzTargetHit("reentrancy_attempt", inputHash, true);
            
            // If reentrancy succeeded, it's a security violation
            emit SecurityPropertyViolated("reentrancy_success", abi.encodePacked(attackType, amount));
        } catch {
            emit FuzzTargetHit("reentrancy_attempt", inputHash, false);
            // Reentrancy protection working correctly
        }
    }
    
    /*//////////////////////////////////////////////////////////////
                        STATE CORRUPTION TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing for state corruption scenarios
    function fuzzTarget_StateCorruption(
        uint256[] calldata amounts,
        address[] calldata users,
        uint8[] calldata operations
    ) external {
        vm.assume(amounts.length == users.length && users.length == operations.length);
        vm.assume(amounts.length > 0 && amounts.length <= 10); // Limit to prevent gas issues
        
        uint256 totalMintedBefore = lookCoin.totalMinted();
        uint256 totalBurnedBefore = lookCoin.totalBurned();
        uint256 totalSupplyBefore = lookCoin.totalSupply();
        
        bytes32 inputHash = keccak256(abi.encodePacked(amounts, users, operations));
        
        vm.startPrank(admin);
        
        // Execute sequence of operations
        for (uint i = 0; i < amounts.length; i++) {
            uint256 amount = amounts[i] % MAX_FUZZ_AMOUNT;
            if (amount == 0) amount = 1;
            
            address user = users[i] == address(0) ? admin : users[i];
            uint8 op = operations[i] % 3; // 3 operation types
            
            try this._executeOperation(op, user, amount) {
                // Operation executed successfully
            } catch {
                // Some operations may fail, which is acceptable
                continue;
            }
        }
        
        vm.stopPrank();
        
        // Verify state consistency after all operations
        bool stateConsistent = _verifyStateConsistency(
            totalMintedBefore,
            totalBurnedBefore,
            totalSupplyBefore
        );
        
        if (!stateConsistent) {
            emit SecurityPropertyViolated("state_corruption", inputHash);
        } else {
            emit FuzzTargetHit("state_sequence", inputHash, true);
        }
    }
    
    /// @notice Execute a single operation (helper for state corruption testing)
    function _executeOperation(uint8 op, address user, uint256 amount) external {
        if (op == 0) {
            // Mint operation
            lookCoin.mint(user, amount);
        } else if (op == 1) {
            // Burn operation (only if user has balance)
            uint256 balance = lookCoin.balanceOf(user);
            if (balance > 0) {
                uint256 burnAmount = amount % (balance + 1);
                if (burnAmount > 0) {
                    lookCoin.burnFrom(user, burnAmount);
                }
            }
        } else if (op == 2) {
            // Transfer operation (only if user has balance)
            uint256 balance = lookCoin.balanceOf(user);
            if (balance > 0) {
                uint256 transferAmount = amount % (balance + 1);
                if (transferAmount > 0) {
                    vm.prank(user);
                    lookCoin.transfer(admin, transferAmount);
                }
            }
        }
    }
    
    /// @notice Verify state consistency after operations
    function _verifyStateConsistency(
        uint256 totalMintedBefore,
        uint256 totalBurnedBefore,
        uint256 totalSupplyBefore
    ) internal view returns (bool) {
        uint256 totalMintedAfter = lookCoin.totalMinted();
        uint256 totalBurnedAfter = lookCoin.totalBurned();
        uint256 totalSupplyAfter = lookCoin.totalSupply();
        
        // Check supply invariant
        if (totalSupplyAfter != totalMintedAfter - totalBurnedAfter) {
            return false;
        }
        
        // Check that minted and burned only increased
        if (totalMintedAfter < totalMintedBefore || totalBurnedAfter < totalBurnedBefore) {
            return false;
        }
        
        return true;
    }
    
    /*//////////////////////////////////////////////////////////////
                        ACCESS CONTROL TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing of access control bypasses
    function fuzzTarget_AccessControlBypass(
        address caller,
        bytes32 role,
        uint256 amount,
        uint8 functionIndex
    ) external {
        vm.assume(caller != address(0));
        amount = bound(amount, MIN_FUZZ_AMOUNT, MAX_FUZZ_AMOUNT);
        functionIndex = uint8(bound(functionIndex, 0, 5)); // 6 protected functions
        
        // Ensure caller doesn't have the required role
        vm.assume(!lookCoin.hasRole(role, caller));
        
        bytes32 inputHash = keccak256(abi.encodePacked(caller, role, amount, functionIndex));
        
        vm.startPrank(caller);
        
        bool shouldRevert = true;
        
        try this._attemptProtectedFunction(functionIndex, caller, amount) {
            // If this succeeds, it might be an access control bypass
            shouldRevert = false;
            emit SecurityPropertyViolated("access_control_bypass", 
                abi.encodePacked(caller, role, functionIndex));
        } catch {
            // Expected behavior - access denied
        }
        
        emit FuzzTargetHit("access_control", inputHash, !shouldRevert);
        
        vm.stopPrank();
    }
    
    /// @notice Attempt to call protected functions (helper)
    function _attemptProtectedFunction(uint8 functionIndex, address caller, uint256 amount) external {
        if (functionIndex == 0) {
            lookCoin.mint(caller, amount);
        } else if (functionIndex == 1) {
            lookCoin.burnFrom(caller, amount);
        } else if (functionIndex == 2) {
            lookCoin.pause();
        } else if (functionIndex == 3) {
            lookCoin.setGasForDestinationLzReceive(350000);
        } else if (functionIndex == 4) {
            lookCoin.setLayerZeroEndpoint(address(this));
        } else if (functionIndex == 5) {
            lookCoin.connectPeer(1, bytes32(uint256(1)));
        }
    }
    
    /*//////////////////////////////////////////////////////////////
                        OVERFLOW/UNDERFLOW TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing for arithmetic overflow/underflow
    function fuzzTarget_ArithmeticEdges(
        uint256 amount1,
        uint256 amount2,
        address user1,
        address user2,
        bool triggerOverflow
    ) external {
        vm.assume(user1 != address(0) && user2 != address(0));
        vm.assume(user1 != user2);
        
        if (triggerOverflow) {
            // Try to trigger overflow conditions
            amount1 = bound(amount1, type(uint256).max / 2, type(uint256).max);
            amount2 = bound(amount2, type(uint256).max / 2, type(uint256).max);
        } else {
            // Normal bounded amounts
            amount1 = bound(amount1, MIN_FUZZ_AMOUNT, MAX_FUZZ_AMOUNT);
            amount2 = bound(amount2, MIN_FUZZ_AMOUNT, MAX_FUZZ_AMOUNT);
        }
        
        bytes32 inputHash = keccak256(abi.encodePacked(amount1, amount2, user1, user2, triggerOverflow));
        
        vm.startPrank(admin);
        
        try lookCoin.mint(user1, amount1) {
            try lookCoin.mint(user2, amount2) {
                emit FuzzTargetHit("arithmetic_edge", inputHash, true);
                
                // Check for overflow in total supply
                if (lookCoin.totalSupply() < amount1 || lookCoin.totalSupply() < amount2) {
                    emit SecurityPropertyViolated("arithmetic_overflow", 
                        abi.encodePacked(amount1, amount2));
                }
            } catch {
                emit FuzzTargetHit("arithmetic_edge", inputHash, false);
            }
        } catch {
            emit FuzzTargetHit("arithmetic_edge", inputHash, false);
        }
        
        vm.stopPrank();
    }
    
    /*//////////////////////////////////////////////////////////////
                        GAS LIMIT TARGETS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Targeted fuzzing for gas limit edge cases
    function fuzzTarget_GasLimits(
        uint256 gasLimit,
        uint256 dataSize,
        bool maliciousData
    ) external {
        gasLimit = bound(gasLimit, 21000, 30000000); // Reasonable gas range
        dataSize = bound(dataSize, 0, 10000); // Data size range
        
        bytes memory data;
        if (maliciousData) {
            // Generate potentially problematic data
            data = new bytes(dataSize);
            for (uint i = 0; i < dataSize; i++) {
                data[i] = bytes1(uint8(i % 256));
            }
        } else {
            // Generate normal data
            data = abi.encodePacked("normal_data_", dataSize);
        }
        
        bytes32 inputHash = keccak256(abi.encodePacked(gasLimit, dataSize, maliciousData));
        
        // Test gas consumption with limited gas
        uint256 gasBefore = gasleft();
        
        try this._gasConsumingOperation{gas: gasLimit}(data) {
            uint256 gasUsed = gasBefore - gasleft();
            
            if (gasUsed > gasLimit) {
                emit SecurityPropertyViolated("gas_limit_exceeded", 
                    abi.encodePacked(gasUsed, gasLimit));
            }
            
            emit FuzzTargetHit("gas_limit", inputHash, true);
        } catch {
            emit FuzzTargetHit("gas_limit", inputHash, false);
        }
    }
    
    /// @notice Gas-consuming operation for testing
    function _gasConsumingOperation(bytes memory data) external pure {
        bytes32 hash = keccak256(data);
        // Perform some gas-consuming operations
        for (uint i = 0; i < 100; i++) {
            hash = keccak256(abi.encodePacked(hash, i));
        }
    }
}

/**
 * @title ReentrancyAttacker
 * @dev Mock contract to test reentrancy vulnerabilities
 */
contract ReentrancyAttacker {
    LookCoin public target;
    uint256 public attackAmount;
    uint8 public attackType;
    bool public attacking;
    
    constructor(address _target) {
        target = LookCoin(_target);
    }
    
    function attemptReentrancy(uint8 _attackType, uint256 _amount) external {
        attackType = _attackType;
        attackAmount = _amount;
        attacking = true;
        
        if (attackType == 0) {
            // Reentrancy via mint
            target.mint(address(this), attackAmount);
        } else if (attackType == 1) {
            // Reentrancy via burn
            target.burn(attackAmount);
        } else if (attackType == 2) {
            // Reentrancy via transfer
            target.transfer(address(0x1), attackAmount);
        } else if (attackType == 3) {
            // Reentrancy via bridgeToken
            target.bridgeToken{value: 0.1 ether}(1, abi.encodePacked(address(0x1)), attackAmount);
        }
        
        attacking = false;
    }
    
    // Fallback to attempt reentrancy
    receive() external payable {
        if (attacking && attackAmount > 0) {
            if (attackType == 0) {
                target.mint(address(this), attackAmount);
            } else if (attackType == 1) {
                target.burn(attackAmount);
            }
        }
    }
}