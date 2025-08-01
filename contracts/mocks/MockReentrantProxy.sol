// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../interfaces/ILookCoin.sol";

/**
 * @title MockReentrantProxy
 * @dev A proxy contract that attempts reentrancy by being called during mint/burn
 * This simulates a scenario where a contract receiving tokens tries to reenter
 */
contract MockReentrantProxy {
    ILookCoin public immutable lookCoin;
    
    // Attack state
    bool public attackEnabled;
    uint256 public reentrancyAttempts;
    uint256 public attackAmount;
    
    // Events
    event ReentrancyAttempted(string method);
    event ReentrancyBlocked(bytes reason);
    
    constructor(address _lookCoin) {
        lookCoin = ILookCoin(_lookCoin);
    }
    
    /**
     * @dev Enable attack mode
     */
    function enableAttack(uint256 _amount) external {
        attackEnabled = true;
        attackAmount = _amount;
        reentrancyAttempts = 0;
    }
    
    /**
     * @dev Disable attack mode
     */
    function disableAttack() external {
        attackEnabled = false;
    }
    
    /**
     * @dev Proxy mint function that attempts reentrancy
     * Note: This won't actually trigger ReentrancyGuard because the calls are sequential,
     * not nested. True reentrancy requires a callback during execution.
     */
    function proxyMint(address to) external {
        // This mint will succeed
        lookCoin.mint(to, attackAmount);
        
        // If attack is enabled, try to mint again
        // This is sequential, not reentrancy, so it will succeed
        if (attackEnabled) {
            reentrancyAttempts++;
            emit ReentrancyAttempted("mint");
            
            // This will succeed because it's a separate call
            lookCoin.mint(to, attackAmount);
        }
    }
    
    /**
     * @dev Proxy burn function that attempts reentrancy
     * Note: This won't actually trigger ReentrancyGuard because the calls are sequential,
     * not nested. True reentrancy requires a callback during execution.
     */
    function proxyBurn(address from) external {
        // This burn will succeed
        lookCoin.burn(from, attackAmount);
        
        // If attack is enabled, try to burn again
        // This is sequential, not reentrancy, so it will succeed
        if (attackEnabled) {
            reentrancyAttempts++;
            emit ReentrancyAttempted("burn");
            
            // This will succeed because it's a separate call
            lookCoin.burn(from, attackAmount);
        }
    }
    
    /**
     * @dev Fallback function that attempts reentrancy when receiving ETH
     */
    receive() external payable {
        if (attackEnabled && address(lookCoin).balance > 0) {
            // Try to exploit during ETH transfer
            reentrancyAttempts++;
            emit ReentrancyAttempted("receive");
            
            try lookCoin.mint(address(this), attackAmount) {
                revert("Reentrancy protection failed!");
            } catch (bytes memory reason) {
                emit ReentrancyBlocked(reason);
            }
        }
    }
}