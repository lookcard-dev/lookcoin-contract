// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title SimpleReentrancyTester
 * @dev Simple contract to demonstrate how ReentrancyGuard blocks reentrancy
 */
contract SimpleReentrancyTester is ReentrancyGuardUpgradeable {
    uint256 public counter;
    address public attacker;
    
    event Executed(uint256 count);
    event ReentrancyAttempted();
    event ReentrancyBlocked();
    
    function initialize() public initializer {
        __ReentrancyGuard_init();
        counter = 0;
    }
    
    /**
     * @dev Function protected by nonReentrant modifier
     */
    function protectedFunction() external nonReentrant {
        counter++;
        
        // If attacker is set, call it (potential reentrancy)
        if (attacker != address(0)) {
            IAttacker(attacker).attack();
        }
        
        emit Executed(counter);
    }
    
    /**
     * @dev Function NOT protected (vulnerable)
     */
    function vulnerableFunction() external {
        counter++;
        
        // If attacker is set, call it (reentrancy will succeed)
        if (attacker != address(0)) {
            IAttacker(attacker).attack();
        }
        
        emit Executed(counter);
    }
    
    function setAttacker(address _attacker) external {
        attacker = _attacker;
    }
}

/**
 * @title SimpleAttacker
 * @dev Attempts reentrancy on the tester contract
 */
contract SimpleAttacker {
    SimpleReentrancyTester public tester;
    uint256 public attackCount;
    bool public attacking;
    
    constructor(address _tester) {
        tester = SimpleReentrancyTester(_tester);
    }
    
    function attack() external {
        if (!attacking && attackCount == 0) {
            attacking = true;
            attackCount++;
            
            // Try to reenter protected function
            try tester.protectedFunction() {
                // This should NOT happen due to ReentrancyGuard
            } catch {
                // This is expected - reentrancy blocked
            }
            
            attacking = false;
        }
    }
    
    function attackVulnerable() external {
        if (!attacking && attackCount == 0) {
            attacking = true;
            attackCount++;
            
            // Try to reenter vulnerable function
            try tester.vulnerableFunction() {
                // This WILL succeed - no guard
            } catch {
                // Unexpected
            }
            
            attacking = false;
        }
    }
    
    function reset() external {
        attackCount = 0;
        attacking = false;
    }
}

interface IAttacker {
    function attack() external;
}

// Helper to emit events from attacker
interface IEventEmitter {
    function emit_ReentrancyAttempted() external;
    function emit_ReentrancyBlocked() external;
}