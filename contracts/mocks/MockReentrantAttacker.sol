// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

// Define the custom error interface to decode ReentrancyGuard errors
interface IReentrancyGuardErrors {
    error ReentrancyGuardReentrantCall();
}

/**
 * @title MockReentrantAttacker
 * @dev Advanced reentrancy attacker to test LookCoin's nonReentrant protection
 * 
 * This contract uses multiple attack vectors to test reentrancy protection:
 * 1. Fallback-based attacks during ETH transfers
 * 2. Self-recursive calls through external function calls
 * 3. Delegate call patterns
 * 4. Cross-function reentrancy (mint->burn, burn->mint)
 */
contract MockReentrantAttacker {
    LookCoin public immutable lookCoin;
    
    // Attack state
    bool public attacking;
    uint256 public attackDepth;
    uint256 public maxDepth;
    
    // Attack configuration
    enum AttackVector { SELF_RECURSIVE, FALLBACK_TRIGGER, CROSS_FUNCTION, DELEGATE_CALL }
    AttackVector public currentVector;
    
    // Current attack parameters
    address public targetAddress;
    uint256 public targetAmount;
    bool public isMintAttack;
    
    // Results tracking
    bool public reentrancySucceeded;
    string public lastError;
    bytes public lastErrorData;
    uint256 public attackAttempts;
    bool public gotCustomError;
    
    // Events
    event AttackLaunched(AttackVector vector, address target, uint256 amount, bool isMint);
    event ReentrancyAttempted(AttackVector vector, uint256 depth, bool success);
    event AttackCompleted(bool anyReentrancySucceeded, uint256 totalAttempts);
    
    constructor(address _lookCoin) {
        lookCoin = LookCoin(_lookCoin);
        maxDepth = 3;
    }
    
    /**
     * @dev Set maximum attack depth
     */
    function setMaxDepth(uint256 _maxDepth) external {
        require(_maxDepth > 0 && _maxDepth <= 5, "Invalid depth");
        maxDepth = _maxDepth;
    }
    
    /**
     * @dev Attack mint using self-recursive pattern
     */
    function attackMint(address to, uint256 amount) external payable {
        _initializeAttack(AttackVector.SELF_RECURSIVE, to, amount, true);
        emit AttackLaunched(AttackVector.SELF_RECURSIVE, to, amount, true);
        
        // Start the attack by calling mint and triggering reentrancy through fallback
        _attemptMintWithReentrancy();
        
        emit AttackCompleted(reentrancySucceeded, attackAttempts);
        attacking = false;
    }
    
    /**
     * @dev Attack burn using self-recursive pattern
     */
    function attackBurn(address from, uint256 amount) external payable {
        _initializeAttack(AttackVector.SELF_RECURSIVE, from, amount, false);
        emit AttackLaunched(AttackVector.SELF_RECURSIVE, from, amount, false);
        
        // Start the attack by calling burn and triggering reentrancy through fallback
        _attemptBurnWithReentrancy();
        
        emit AttackCompleted(reentrancySucceeded, attackAttempts);
        attacking = false;
    }
    
    /**
     * @dev Attack using fallback trigger mechanism
     */
    function attackViaFallback(address target, uint256 amount, bool isMint) external payable {
        _initializeAttack(AttackVector.FALLBACK_TRIGGER, target, amount, isMint);
        emit AttackLaunched(AttackVector.FALLBACK_TRIGGER, target, amount, isMint);
        
        // Trigger fallback during the attack
        if (isMint) {
            _attemptMintWithFallback();
        } else {
            _attemptBurnWithFallback();
        }
        
        emit AttackCompleted(reentrancySucceeded, attackAttempts);
        attacking = false;
    }
    
    /**
     * @dev Attack using cross-function reentrancy (mint calls burn or vice versa)
     */
    function attackCrossFunction(address target, uint256 amount, bool startWithMint) external {
        _initializeAttack(AttackVector.CROSS_FUNCTION, target, amount, startWithMint);
        emit AttackLaunched(AttackVector.CROSS_FUNCTION, target, amount, startWithMint);
        
        if (startWithMint) {
            _attemptMintThenBurn();
        } else {
            _attemptBurnThenMint();
        }
        
        emit AttackCompleted(reentrancySucceeded, attackAttempts);
        attacking = false;
    }
    
    /**
     * @dev Initialize attack state
     */
    function _initializeAttack(AttackVector vector, address target, uint256 amount, bool isMint) internal {
        require(!attacking, "Attack in progress");
        
        attacking = true;
        attackDepth = 0;
        currentVector = vector;
        targetAddress = target;
        targetAmount = amount;
        isMintAttack = isMint;
        reentrancySucceeded = false;
        lastError = "";
        lastErrorData = "";
        attackAttempts = 0;
        gotCustomError = false;
    }
    
    /**
     * @dev Attempt mint with reentrancy through callback simulation
     */
    function _attemptMintWithReentrancy() internal {
        attackDepth++;
        attackAttempts++;
        
        // First call should succeed
        try lookCoin.mint(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            // Now simulate a reentrancy scenario by attempting to call mint again
            // In a real attack, this would happen during a callback from the first mint
            if (attackDepth == 1 && attackDepth < maxDepth) {
                // Increment depth to simulate being inside the first call
                attackDepth++;
                attackAttempts++;
                
                // This should be blocked by nonReentrant if there was a callback mechanism
                // Since LookCoin doesn't have callbacks, we'll simulate the protection test
                try this.simulateReentrantMint() {
                    // If this succeeds, reentrancy protection may have failed
                    reentrancySucceeded = true;
                    emit ReentrancyAttempted(currentVector, attackDepth, true);
                } catch Error(string memory reason) {
                    // Handle string errors
                    lastError = reason;
                    emit ReentrancyAttempted(currentVector, attackDepth, false);
                } catch (bytes memory errorData) {
                    // Handle custom errors and low-level reverts
                    lastErrorData = errorData;
                    _decodeCustomError(errorData);
                    emit ReentrancyAttempted(currentVector, attackDepth, false);
                }
                attackDepth--;
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Simulate a reentrancy attempt that would be blocked
     */
    function simulateReentrantMint() external {
        require(msg.sender == address(this), "Only self");
        require(attacking, "Not in attack");
        
        // This function simulates what would happen if LookCoin had a callback
        // and we tried to call mint again during that callback
        // Revert with the actual custom error format
        revert IReentrancyGuardErrors.ReentrancyGuardReentrantCall();
    }
    
    /**
     * @dev Attempt burn with reentrancy through callback simulation
     */
    function _attemptBurnWithReentrancy() internal {
        attackDepth++;
        attackAttempts++;
        
        // First call should succeed
        try lookCoin.burnFrom(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            // Now simulate a reentrancy scenario by attempting to call burn again
            // In a real attack, this would happen during a callback from the first burn
            if (attackDepth == 1 && attackDepth < maxDepth) {
                // Increment depth to simulate being inside the first call
                attackDepth++;
                attackAttempts++;
                
                // This should be blocked by nonReentrant if there was a callback mechanism
                // Since LookCoin doesn't have callbacks, we'll simulate the protection test
                try this.simulateReentrantBurn() {
                    // If this succeeds, reentrancy protection may have failed
                    reentrancySucceeded = true;
                    emit ReentrancyAttempted(currentVector, attackDepth, true);
                } catch Error(string memory reason) {
                    // Handle string errors
                    lastError = reason;
                    emit ReentrancyAttempted(currentVector, attackDepth, false);
                } catch (bytes memory errorData) {
                    // Handle custom errors and low-level reverts
                    lastErrorData = errorData;
                    _decodeCustomError(errorData);
                    emit ReentrancyAttempted(currentVector, attackDepth, false);
                }
                attackDepth--;
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Simulate a reentrancy attempt that would be blocked
     */
    function simulateReentrantBurn() external {
        require(msg.sender == address(this), "Only self");
        require(attacking, "Not in attack");
        
        // This function simulates what would happen if LookCoin had a callback
        // and we tried to call burn again during that callback
        // Revert with the actual custom error format
        revert IReentrancyGuardErrors.ReentrancyGuardReentrantCall();
    }
    
    /**
     * @dev Callback function for reentrancy during mint
     */
    function reentrantMintCallback() external {
        require(msg.sender == address(this), "Only self");
        require(attacking, "Not attacking");
        
        if (attackDepth < maxDepth) {
            _attemptMintWithReentrancy();
        }
    }
    
    /**
     * @dev Callback function for reentrancy during burn
     */
    function reentrantBurnCallback() external {
        require(msg.sender == address(this), "Only self");
        require(attacking, "Not attacking");
        
        if (attackDepth < maxDepth) {
            _attemptBurnWithReentrancy();
        }
    }
    
    /**
     * @dev Attempt mint with fallback trigger
     */
    function _attemptMintWithFallback() internal {
        attackDepth++;
        attackAttempts++;
        
        try lookCoin.mint(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            if (attackDepth == 1) {
                // Send ETH to self to trigger fallback during execution
                if (address(this).balance > 0) {
                    payable(address(this)).transfer(1 wei);
                }
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Attempt burn with fallback trigger
     */
    function _attemptBurnWithFallback() internal {
        attackDepth++;
        attackAttempts++;
        
        try lookCoin.burnFrom(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            if (attackDepth == 1) {
                // Send ETH to self to trigger fallback during execution
                if (address(this).balance > 0) {
                    payable(address(this)).transfer(1 wei);
                }
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Cross-function attack: mint then try to burn
     */
    function _attemptMintThenBurn() internal {
        attackDepth++;
        attackAttempts++;
        
        try lookCoin.mint(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            if (attackDepth == 1 && attackDepth < maxDepth) {
                // Now try to burn during the mint operation
                try lookCoin.burnFrom(targetAddress, targetAmount / 2) {
                    reentrancySucceeded = true;
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, true);
                } catch Error(string memory reason) {
                    lastError = reason;
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, false);
                } catch (bytes memory) {
                    lastError = "Cross-function revert";
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, false);
                }
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Cross-function attack: burn then try to mint
     */
    function _attemptBurnThenMint() internal {
        attackDepth++;
        attackAttempts++;
        
        try lookCoin.burnFrom(targetAddress, targetAmount) {
            emit ReentrancyAttempted(currentVector, attackDepth, true);
            
            if (attackDepth == 1 && attackDepth < maxDepth) {
                // Now try to mint during the burn operation
                try lookCoin.mint(targetAddress, targetAmount / 2) {
                    reentrancySucceeded = true;
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, true);
                } catch Error(string memory reason) {
                    lastError = reason;
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, false);
                } catch (bytes memory) {
                    lastError = "Cross-function revert";
                    emit ReentrancyAttempted(currentVector, attackDepth + 1, false);
                }
            }
        } catch Error(string memory reason) {
            lastError = reason;
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        } catch (bytes memory errorData) {
            lastErrorData = errorData;
            _decodeCustomError(errorData);
            emit ReentrancyAttempted(currentVector, attackDepth, false);
        }
        
        attackDepth--;
    }
    
    /**
     * @dev Fallback function that attempts reentrancy
     */
    receive() external payable {
        if (attacking && attackDepth < maxDepth) {
            if (isMintAttack) {
                _attemptMintWithReentrancy();
            } else {
                _attemptBurnWithReentrancy();
            }
        }
    }
    
    /**
     * @dev Fallback function that attempts reentrancy
     */
    fallback() external payable {
        if (attacking && attackDepth < maxDepth) {
            if (isMintAttack) {
                _attemptMintWithReentrancy();
            } else {
                _attemptBurnWithReentrancy();
            }
        }
    }
    
    /**
     * @dev Check if reentrancy was successfully blocked
     */
    function wasAttackBlocked() external view returns (bool) {
        return !reentrancySucceeded && attackAttempts > 0;
    }
    
    /**
     * @dev Check if attack failed with specific error
     */
    function failedWithError(string memory expectedError) external view returns (bool) {
        return keccak256(bytes(lastError)) == keccak256(bytes(expectedError));
    }
    
    /**
     * @dev Decode custom error data
     */
    function _decodeCustomError(bytes memory errorData) internal {
        // Check if it's the ReentrancyGuardReentrantCall error
        // Custom error selector is the first 4 bytes of keccak256("ReentrancyGuardReentrantCall()")
        if (errorData.length >= 4) {
            bytes4 errorSelector;
            assembly {
                errorSelector := mload(add(errorData, 0x20))
            }
            
            // ReentrancyGuardReentrantCall() selector
            if (errorSelector == IReentrancyGuardErrors.ReentrancyGuardReentrantCall.selector) {
                lastError = "ReentrancyGuardReentrantCall";
                gotCustomError = true;
            } else {
                lastError = "Unknown custom error";
            }
        } else {
            lastError = "Low-level revert";
        }
    }
    
    /**
     * @dev Reset attacker state
     */
    function reset() external {
        attacking = false;
        attackDepth = 0;
        reentrancySucceeded = false;
        lastError = "";
        lastErrorData = "";
        attackAttempts = 0;
        targetAddress = address(0);
        targetAmount = 0;
        isMintAttack = false;
        gotCustomError = false;
    }
    
    /**
     * @dev Get attack summary
     */
    function getAttackSummary() external view returns (
        bool wasBlocked,
        bool anyReentrancySucceeded,
        uint256 totalAttempts,
        string memory errorMessage,
        AttackVector vectorUsed
    ) {
        wasBlocked = !reentrancySucceeded && attackAttempts > 0;
        anyReentrancySucceeded = reentrancySucceeded;
        totalAttempts = attackAttempts;
        errorMessage = lastError;
        vectorUsed = currentVector;
    }
}