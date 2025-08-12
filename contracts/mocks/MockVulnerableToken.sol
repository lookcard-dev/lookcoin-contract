// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title MockVulnerableToken
 * @dev A vulnerable token contract WITHOUT reentrancy guards to demonstrate the attack
 * This shows what would happen if LookCoin didn't have nonReentrant modifiers
 */
contract MockVulnerableToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public hasMinterRole;
    mapping(address => bool) public hasBurnerRole;
    
    uint256 public totalSupply;
    uint256 public totalMinted;
    uint256 public totalBurned;
    
    address public admin;
    address public mintBurnHook;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor() {
        admin = msg.sender;
        hasMinterRole[msg.sender] = true;
        hasBurnerRole[msg.sender] = true;
    }
    
    function setMintBurnHook(address _hook) external {
        require(msg.sender == admin, "Not admin");
        mintBurnHook = _hook;
    }
    
    function grantMinterRole(address account) external {
        require(msg.sender == admin, "Not admin");
        hasMinterRole[account] = true;
    }
    
    function grantBurnerRole(address account) external {
        require(msg.sender == admin, "Not admin");
        hasBurnerRole[account] = true;
    }
    
    /**
     * @dev Mint function WITHOUT reentrancy protection
     */
    function mint(address to, uint256 amount) external {
        require(to != address(0), "Mint to zero address");
        require(hasMinterRole[msg.sender], "Unauthorized minter");
        
        // Call hook BEFORE state changes (vulnerable to reentrancy)
        if (mintBurnHook != address(0)) {
            IMintBurnHook(mintBurnHook).onBeforeMint(msg.sender, to, amount);
        }
        
        // State changes
        totalMinted += amount;
        totalSupply += amount;
        balanceOf[to] += amount;
        
        emit Transfer(address(0), to, amount);
        
        // Call hook after
        if (mintBurnHook != address(0)) {
            IMintBurnHook(mintBurnHook).onAfterMint(msg.sender, to, amount);
        }
    }
    
    /**
     * @dev Burn function WITHOUT reentrancy protection
     */
    function burn(address from, uint256 amount) external {
        require(from != address(0), "Burn from zero address");
        require(hasBurnerRole[msg.sender], "Unauthorized burner");
        require(balanceOf[from] >= amount, "Insufficient balance");
        
        // Call hook BEFORE state changes (vulnerable to reentrancy)
        if (mintBurnHook != address(0)) {
            IMintBurnHook(mintBurnHook).onBeforeBurn(msg.sender, from, amount);
        }
        
        // State changes
        totalBurned += amount;
        totalSupply -= amount;
        balanceOf[from] -= amount;
        
        emit Transfer(from, address(0), amount);
        
        // Call hook after
        if (mintBurnHook != address(0)) {
            IMintBurnHook(mintBurnHook).onAfterBurn(msg.sender, from, amount);
        }
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

/**
 * @dev Interface for mint/burn hooks
 */
interface IMintBurnHook {
    function onBeforeMint(address operator, address to, uint256 amount) external;
    function onAfterMint(address operator, address to, uint256 amount) external;
    function onBeforeBurn(address operator, address from, uint256 amount) external;
    function onAfterBurn(address operator, address from, uint256 amount) external;
}