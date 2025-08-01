// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IVulnerableToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function hasMinterRole(address account) external view returns (bool);
    function hasBurnerRole(address account) external view returns (bool);
}

/**
 * @title MockReentrantVulnerableAttacker
 * @dev Demonstrates successful reentrancy attack on vulnerable token
 */
contract MockReentrantVulnerableAttacker {
    IVulnerableToken public immutable vulnerableToken;
    
    // State variables to control reentrancy flow
    bool public attackEnabled;
    bool public inHook;
    uint256 public reentrancyAttempts;
    uint256 public successfulReentries;
    
    // Attack parameters
    address public attackTarget;
    uint256 public attackAmount;
    bool public attackMintNotBurn;
    
    // Track stolen tokens
    uint256 public tokensStolen;
    
    // Events
    event ReentrancyAttempted(bool success, uint256 stolenAmount);
    event HookCalled(string hookType);
    
    constructor(address _token) {
        vulnerableToken = IVulnerableToken(_token);
    }
    
    /**
     * @dev Attempts a reentrancy attack on the mint function
     */
    function attackMint(address to, uint256 amount) external {
        // Reset state
        reentrancyAttempts = 0;
        successfulReentries = 0;
        tokensStolen = 0;
        attackEnabled = true;
        attackMintNotBurn = true;
        attackTarget = to;
        attackAmount = amount;
        
        // Perform the initial mint - this will trigger the hook
        vulnerableToken.mint(to, amount);
        
        // Disable attack after completion
        attackEnabled = false;
    }
    
    /**
     * @dev Hook called before mint - this is where we perform reentrancy
     */
    function onBeforeMint(address operator, address to, uint256 amount) external {
        emit HookCalled("onBeforeMint");
        
        // Only attempt reentrancy if attack is enabled and we're not already in a hook
        if (attackEnabled && !inHook && msg.sender == address(vulnerableToken)) {
            inHook = true;
            reentrancyAttempts++;
            
            // Attempt to mint more tokens during the original mint
            // This should succeed on vulnerable token but fail on protected one
            uint256 balanceBefore = vulnerableToken.balanceOf(attackTarget);
            
            try vulnerableToken.mint(attackTarget, attackAmount) {
                uint256 balanceAfter = vulnerableToken.balanceOf(attackTarget);
                uint256 stolen = balanceAfter - balanceBefore;
                tokensStolen += stolen;
                successfulReentries++;
                emit ReentrancyAttempted(true, stolen);
            } catch {
                emit ReentrancyAttempted(false, 0);
            }
            
            inHook = false;
        }
    }
    
    function onAfterMint(address operator, address to, uint256 amount) external {
        // Not used in this attack
    }
    
    function onBeforeBurn(address operator, address from, uint256 amount) external {
        // Not used in this attack
    }
    
    function onAfterBurn(address operator, address from, uint256 amount) external {
        // Not used in this attack
    }
    
    /**
     * @dev Check if the reentrancy attack was successful
     */
    function wasAttackSuccessful() external view returns (bool) {
        return successfulReentries > 0 && tokensStolen > 0;
    }
}