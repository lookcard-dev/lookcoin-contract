// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// import "@celer-network/messagebus/contracts/apps/MessageSenderApp.sol";
// import "@celer-network/messagebus/contracts/apps/MessageReceiverApp.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILookCoin {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

/**
 * @title CelerIMModule
 * @dev Celer IM bridge module for LookCoin cross-chain transfers using lock-and-mint mechanism
 */
contract CelerIMModule is 
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // State variables
    ILookCoin public lookCoin;
    mapping(uint64 => address) public remoteModules; // chainId => module address
    mapping(address => bool) public whitelist;
    mapping(address => bool) public blacklist;
    
    // Rate limiting
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    uint256 public userTransferLimit;
    uint256 public globalTransferLimit;
    
    struct RateLimitData {
        uint256 transferAmount;
        uint256 windowStart;
    }
    
    mapping(address => RateLimitData) public userRateLimits;
    RateLimitData public globalRateLimit;
    
    // Fee parameters
    uint256 public feePercentage; // Basis points (1% = 100)
    uint256 public minFee;
    uint256 public maxFee;
    address public feeCollector;
    
    // Events
    event CrossChainTransferLocked(
        address indexed sender,
        uint64 indexed dstChainId,
        address indexed recipient,
        uint256 amount,
        uint256 fee
    );
    event CrossChainTransferMinted(
        uint64 indexed srcChainId,
        address indexed sender,
        address indexed recipient,
        uint256 amount
    );
    event RemoteModuleSet(uint64 indexed chainId, address module);
    event FeeParametersUpdated(uint256 feePercentage, uint256 minFee, uint256 maxFee);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    /**
     * @dev Initialize the Celer IM module
     * @param _messageBus Celer MessageBus address
     * @param _lookCoin LookCoin contract address
     * @param _admin Admin address
     */
    function initialize(
        address _messageBus,
        address _lookCoin,
        address _admin
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        
        lookCoin = ILookCoin(_lookCoin);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        
        // Initialize defaults
        userTransferLimit = 100000 * 10**lookCoin.decimals();
        globalTransferLimit = 10000000 * 10**lookCoin.decimals();
        feePercentage = 50; // 0.5%
        minFee = 10 * 10**lookCoin.decimals();
        maxFee = 1000 * 10**lookCoin.decimals();
        feeCollector = _admin;
    }

    /**
     * @dev Lock LOOK tokens and initiate cross-chain transfer
     * @param _dstChainId Destination chain ID
     * @param _recipient Recipient address on destination chain
     * @param _amount Amount to transfer
     */
    function lockAndBridge(
        uint64 _dstChainId,
        address _recipient,
        uint256 _amount
    ) external payable whenNotPaused nonReentrant {
        require(!blacklist[msg.sender], "CelerIM: sender blacklisted");
        require(whitelist[msg.sender] || !paused(), "CelerIM: not whitelisted");
        require(_recipient != address(0), "CelerIM: invalid recipient");
        require(_amount > 0, "CelerIM: invalid amount");
        require(remoteModules[_dstChainId] != address(0), "CelerIM: unsupported chain");
        
        _checkRateLimit(msg.sender, _amount);
        
        // Calculate fee
        uint256 fee = calculateFee(_amount);
        uint256 netAmount = _amount - fee;
        
        // Lock tokens
        IERC20(address(lookCoin)).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Transfer fee to collector
        if (fee > 0) {
            IERC20(address(lookCoin)).safeTransfer(feeCollector, fee);
        }
        
        // Encode message
        bytes memory message = abi.encode(msg.sender, _recipient, netAmount);
        
        // Send cross-chain message (implementation placeholder)
        // sendMessage(_dstChainId, remoteModules[_dstChainId], message);
        
        emit CrossChainTransferLocked(msg.sender, _dstChainId, _recipient, netAmount, fee);
    }

    /**
     * @dev Execute incoming cross-chain message and mint tokens
     * @param _sender Sender address on source chain
     * @param _srcChainId Source chain ID
     * @param _message Encoded message data
     * @param _executor Executor address
     */
    function executeMessage(
        address _sender,
        uint64 _srcChainId,
        bytes calldata _message,
        address _executor
    ) external payable whenNotPaused returns (bool) {
        require(_sender == remoteModules[_srcChainId], "CelerIM: unauthorized sender");
        
        // Decode message
        (address originalSender, address recipient, uint256 amount) = abi.decode(
            _message,
            (address, address, uint256)
        );
        
        require(!blacklist[recipient], "CelerIM: recipient blacklisted");
        
        // Mint tokens to recipient
        lookCoin.mint(recipient, amount);
        
        emit CrossChainTransferMinted(_srcChainId, originalSender, recipient, amount);
        
        return true;
    }

    /**
     * @dev Calculate transfer fee
     * @param _amount Transfer amount
     * @return fee Fee amount
     */
    function calculateFee(uint256 _amount) public view returns (uint256 fee) {
        fee = (_amount * feePercentage) / 10000;
        if (fee < minFee) fee = minFee;
        if (fee > maxFee) fee = maxFee;
    }

    /**
     * @dev Set remote module address for a chain
     * @param _chainId Chain ID
     * @param _module Module address
     */
    function setRemoteModule(uint64 _chainId, address _module) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        remoteModules[_chainId] = _module;
        emit RemoteModuleSet(_chainId, _module);
    }

    /**
     * @dev Update fee parameters
     * @param _feePercentage New fee percentage
     * @param _minFee New minimum fee
     * @param _maxFee New maximum fee
     */
    function updateFeeParameters(
        uint256 _feePercentage,
        uint256 _minFee,
        uint256 _maxFee
    ) external onlyRole(ADMIN_ROLE) {
        require(_feePercentage <= 1000, "CelerIM: fee too high"); // Max 10%
        require(_minFee <= _maxFee, "CelerIM: invalid fee range");
        
        feePercentage = _feePercentage;
        minFee = _minFee;
        maxFee = _maxFee;
        
        emit FeeParametersUpdated(_feePercentage, _minFee, _maxFee);
    }

    /**
     * @dev Update rate limits
     * @param _userLimit New user transfer limit
     * @param _globalLimit New global transfer limit
     */
    function updateRateLimits(uint256 _userLimit, uint256 _globalLimit) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        userTransferLimit = _userLimit;
        globalTransferLimit = _globalLimit;
    }

    /**
     * @dev Add/remove address from whitelist
     * @param _address Address to update
     * @param _whitelisted Whitelist status
     */
    function updateWhitelist(address _address, bool _whitelisted) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        whitelist[_address] = _whitelisted;
    }

    /**
     * @dev Add/remove address from blacklist
     * @param _address Address to update
     * @param _blacklisted Blacklist status
     */
    function updateBlacklist(address _address, bool _blacklisted) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        blacklist[_address] = _blacklisted;
    }

    /**
     * @dev Emergency withdraw tokens
     * @param _token Token address
     * @param _to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(ADMIN_ROLE) {
        require(_to != address(0), "CelerIM: invalid recipient");
        
        if (_token == address(0)) {
            payable(_to).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
        
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /**
     * @dev Pause the contract
     */
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Check rate limits
     * @param _user User address
     * @param _amount Transfer amount
     */
    function _checkRateLimit(address _user, uint256 _amount) internal {
        uint256 currentTime = block.timestamp;
        
        // Check user rate limit
        RateLimitData storage userLimit = userRateLimits[_user];
        if (currentTime > userLimit.windowStart + RATE_LIMIT_WINDOW) {
            userLimit.windowStart = currentTime;
            userLimit.transferAmount = 0;
        }
        
        require(
            userLimit.transferAmount + _amount <= userTransferLimit,
            "CelerIM: user transfer limit exceeded"
        );
        
        userLimit.transferAmount += _amount;
        
        // Check global rate limit
        if (currentTime > globalRateLimit.windowStart + RATE_LIMIT_WINDOW) {
            globalRateLimit.windowStart = currentTime;
            globalRateLimit.transferAmount = 0;
        }
        
        require(
            globalRateLimit.transferAmount + _amount <= globalTransferLimit,
            "CelerIM: global transfer limit exceeded"
        );
        
        globalRateLimit.transferAmount += _amount;
    }
}