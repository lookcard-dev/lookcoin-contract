// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// import "@layerzerolabs/oft-evm/contracts/oft/v2/OFTV2Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title LookCoin
 * @dev Omnichain fungible token implementing LayerZero OFT V2 with UUPS upgradeability
 * @notice LookCoin (LOOK) is the primary payment method for LookCard's crypto-backed credit/debit card system
 */
contract LookCoin is 
    ERC20Upgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // Rate limiting
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    uint256 public maxTransferPerWindow;
    uint256 public maxTransactionsPerWindow;
    
    struct RateLimitData {
        uint256 transferAmount;
        uint256 transactionCount;
        uint256 windowStart;
    }
    
    mapping(address => RateLimitData) public userRateLimits;
    RateLimitData public globalRateLimit;

    // Supply tracking
    uint256 public totalMinted;
    uint256 public totalBurned;
    
    // Events
    event RateLimitUpdated(uint256 maxTransferPerWindow, uint256 maxTransactionsPerWindow);
    event EmergencyPause(address indexed by);
    event EmergencyUnpause(address indexed by);
    event CrossChainTransferInitiated(
        address indexed from,
        uint16 indexed dstChainId,
        bytes indexed toAddress,
        uint256 amount
    );
    event CrossChainTransferReceived(
        uint16 indexed srcChainId,
        bytes indexed fromAddress,
        address indexed to,
        uint256 amount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract with token parameters
     * @param _admin Address to be granted admin role
     */
    function initialize(
        address _admin
    ) public initializer {
        __ERC20_init("LookCoin", "LOOK");
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);

        // Initialize rate limits
        maxTransferPerWindow = 1000000 * 10**18; // 1M tokens (18 decimals)
        maxTransactionsPerWindow = 100;
    }

    /**
     * @dev Mint tokens to address. Only callable by MINTER_ROLE (bridge modules)
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) 
        external 
        onlyRole(MINTER_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        require(to != address(0), "LookCoin: mint to zero address");
        _checkRateLimit(to, amount);
        
        totalMinted += amount;
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from address. Only callable by BURNER_ROLE (LayerZero module)
     * @param from Address to burn tokens from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) 
        external 
        onlyRole(BURNER_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        require(from != address(0), "LookCoin: burn from zero address");
        
        totalBurned += amount;
        _burn(from, amount);
    }

    /**
     * @dev Pause all token operations. Only callable by PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit EmergencyPause(msg.sender);
    }

    /**
     * @dev Unpause all token operations. Only callable by PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit EmergencyUnpause(msg.sender);
    }

    /**
     * @dev Update rate limiting parameters. Only callable by DEFAULT_ADMIN_ROLE
     * @param _maxTransferPerWindow Maximum transfer amount per window
     * @param _maxTransactionsPerWindow Maximum transactions per window
     */
    function updateRateLimits(
        uint256 _maxTransferPerWindow,
        uint256 _maxTransactionsPerWindow
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxTransferPerWindow = _maxTransferPerWindow;
        maxTransactionsPerWindow = _maxTransactionsPerWindow;
        emit RateLimitUpdated(_maxTransferPerWindow, _maxTransactionsPerWindow);
    }

    /**
     * @dev Get circulating supply (minted minus burned)
     * @return Current circulating supply
     */
    function circulatingSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    /**
     * @dev Override _update to add pause functionality (OpenZeppelin v5)
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        super._update(from, to, amount);
    }

    /**
     * @dev Override decimals to return 18 (standard ERC20)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /**
     * @dev Check rate limits for transfers
     * @param user User address
     * @param amount Transfer amount
     */
    function _checkRateLimit(address user, uint256 amount) internal {
        uint256 currentTime = block.timestamp;
        
        // Check user rate limit
        RateLimitData storage userLimit = userRateLimits[user];
        if (currentTime > userLimit.windowStart + RATE_LIMIT_WINDOW) {
            userLimit.windowStart = currentTime;
            userLimit.transferAmount = 0;
            userLimit.transactionCount = 0;
        }
        
        require(
            userLimit.transferAmount + amount <= maxTransferPerWindow,
            "LookCoin: user transfer limit exceeded"
        );
        require(
            userLimit.transactionCount + 1 <= maxTransactionsPerWindow,
            "LookCoin: user transaction limit exceeded"
        );
        
        userLimit.transferAmount += amount;
        userLimit.transactionCount += 1;
        
        // Check global rate limit
        if (currentTime > globalRateLimit.windowStart + RATE_LIMIT_WINDOW) {
            globalRateLimit.windowStart = currentTime;
            globalRateLimit.transferAmount = 0;
            globalRateLimit.transactionCount = 0;
        }
        
        require(
            globalRateLimit.transferAmount + amount <= maxTransferPerWindow * 100,
            "LookCoin: global transfer limit exceeded"
        );
        
        globalRateLimit.transferAmount += amount;
        globalRateLimit.transactionCount += 1;
    }

    /**
     * @dev Authorize contract upgrade. Only callable by UPGRADER_ROLE
     * @param newImplementation Address of new implementation
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(UPGRADER_ROLE) 
    {}

    /**
     * @dev Override supportsInterface for multiple inheritance
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}