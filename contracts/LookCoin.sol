// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title LookCoin
 * @dev Omnichain fungible token with LayerZero integration capabilities
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
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    // LayerZero integration state
    address public lzEndpoint;
    mapping(uint16 => bytes32) public trustedRemoteLookup;
    
    // Supply tracking
    uint256 public totalMinted;
    uint256 public totalBurned;
    
    // Rate limiting (simplified for now)
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    uint256 public maxTransferPerWindow;
    uint256 public maxTransactionsPerWindow;
    
    struct RateLimitData {
        uint256 transferAmount;
        uint256 transactionCount;
        uint256 windowStart;
    }
    
    mapping(address => RateLimitData) public userRateLimits;
    
    // Events
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
    event DVNConfigured(address[] dvns, uint8 requiredDVNs, uint8 optionalDVNs, uint8 threshold);
    event PeerConnected(uint16 indexed chainId, bytes32 indexed peer);
    event LayerZeroEndpointSet(address indexed endpoint);
    event RateLimitUpdated(uint256 maxTransferPerWindow, uint256 maxTransactionsPerWindow);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract with token parameters
     * @param _admin Address to be granted admin role
     * @param _lzEndpoint LayerZero endpoint address (can be zero for non-LZ chains)
     */
    function initialize(
        address _admin,
        address _lzEndpoint
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

        // Set LayerZero endpoint if provided
        if (_lzEndpoint != address(0)) {
            lzEndpoint = _lzEndpoint;
            emit LayerZeroEndpointSet(_lzEndpoint);
        }
        
        // Initialize rate limiting defaults
        maxTransferPerWindow = 500000 * 10**18;
        maxTransactionsPerWindow = 3;
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
     * @dev Burn tokens from address. Only callable by BURNER_ROLE
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
     * @dev Bridge function for cross-chain transfers (simplified LayerZero-style)
     * @param _dstChainId Destination chain ID
     * @param _toAddress Recipient address on destination chain
     * @param _amount Amount to transfer
     */
    function bridgeToken(
        uint16 _dstChainId,
        bytes calldata _toAddress,
        uint256 _amount
    ) external payable whenNotPaused nonReentrant {
        require(lzEndpoint != address(0), "LookCoin: LayerZero not configured");
        require(trustedRemoteLookup[_dstChainId] != bytes32(0), "LookCoin: destination not trusted");
        require(_amount > 0, "LookCoin: invalid amount");
        
        // Burn tokens on source chain
        totalBurned += _amount;
        _burn(msg.sender, _amount);
        
        emit CrossChainTransferInitiated(msg.sender, _dstChainId, _toAddress, _amount);
        
        // In production, this would call LayerZero endpoint
        // For now, we emit the event for tracking
    }

    /**
     * @dev Receive tokens from another chain (called by bridge)
     * @param _srcChainId Source chain ID
     * @param _fromAddress Sender address on source chain
     * @param _toAddress Recipient address
     * @param _amount Amount to mint
     */
    function receiveTokens(
        uint16 _srcChainId,
        bytes calldata _fromAddress,
        address _toAddress,
        uint256 _amount
    ) external onlyRole(BRIDGE_ROLE) whenNotPaused nonReentrant {
        require(_toAddress != address(0), "LookCoin: mint to zero address");
        require(trustedRemoteLookup[_srcChainId] != bytes32(0), "LookCoin: source not trusted");
        
        totalMinted += _amount;
        _mint(_toAddress, _amount);
        
        emit CrossChainTransferReceived(_srcChainId, _fromAddress, _toAddress, _amount);
    }

    /**
     * @dev Configure DVN settings for LayerZero security
     * @param dvns Array of DVN addresses
     * @param requiredDVNs Number of required DVNs
     * @param optionalDVNs Number of optional DVNs
     * @param threshold Percentage threshold for validation (e.g., 66 for 66%)
     */
    function configureDVN(
        address[] calldata dvns,
        uint8 requiredDVNs,
        uint8 optionalDVNs,
        uint8 threshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(dvns.length >= requiredDVNs + optionalDVNs, "LookCoin: insufficient DVNs");
        require(threshold > 0 && threshold <= 100, "LookCoin: invalid threshold");
        
        // In production, this would configure LayerZero DVN settings
        // For now, we emit the event for tracking
        
        emit DVNConfigured(dvns, requiredDVNs, optionalDVNs, threshold);
    }

    /**
     * @dev Connect peer contract on another chain
     * @param _dstChainId Destination chain ID
     * @param _peer Peer contract address on destination chain
     */
    function connectPeer(uint16 _dstChainId, bytes32 _peer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedRemoteLookup[_dstChainId] = _peer;
        emit PeerConnected(_dstChainId, _peer);
    }

    /**
     * @dev Set LayerZero endpoint address
     * @param _endpoint New endpoint address
     */
    function setLayerZeroEndpoint(address _endpoint) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_endpoint != address(0), "LookCoin: invalid endpoint");
        lzEndpoint = _endpoint;
        emit LayerZeroEndpointSet(_endpoint);
    }

    /**
     * @dev Update rate limiting parameters
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
     * @dev Get circulating supply (minted minus burned)
     * @return Current circulating supply
     */
    function circulatingSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
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
    }

    /**
     * @dev Override _update to add pause functionality
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        super._update(from, to, amount);
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