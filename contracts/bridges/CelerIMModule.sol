// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// RateLimiter import removed for now

interface ILookCoin {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

interface IMessageBus {
    function sendMessageWithTransfer(
        address _receiver,
        uint256 _chainId,
        bytes calldata _message,
        address _bridgeAddress,
        bytes32 _transferId,
        uint256 _fee
    ) external payable;
    
    function feeBase() external view returns (uint256);
    function feePerByte() external view returns (uint256);
}

interface IMessageReceiverApp {
    function executeMessageWithTransfer(
        address _sender,
        address _token,
        uint256 _amount,
        uint64 _srcChainId,
        bytes memory _message,
        address _executor
    ) external payable returns (ExecutionStatus);
    
    function executeMessageWithTransferRefund(
        address _token,
        uint256 _amount,
        bytes calldata _message,
        address _executor
    ) external payable returns (ExecutionStatus);
    
    enum ExecutionStatus {
        Fail,
        Success,
        Retry
    }
}

/**
 * @title CelerIMModule
 * @dev Celer IM bridge module for LookCoin cross-chain transfers using lock-and-mint mechanism
 */
contract CelerIMModule is 
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IMessageReceiverApp
{
    using SafeERC20 for IERC20;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Chain ID constants
    uint64 public constant BSC_CHAINID = 56;
    uint64 public constant OPTIMISM_CHAINID = 10;
    uint64 public constant SAPPHIRE_CHAINID = 23295;

    // State variables
    ILookCoin public lookCoin;
    IMessageBus public messageBus;
    mapping(uint64 => address) public remoteModules; // chainId => module address
    mapping(address => bool) public whitelist;
    mapping(address => bool) public blacklist;
    mapping(bytes32 => bool) public processedTransfers;
    
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
        uint256 fee,
        bytes32 transferId
    );
    event CrossChainTransferMinted(
        uint64 indexed srcChainId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        bytes32 transferId
    );
    event RemoteModuleSet(uint64 indexed chainId, address module);
    event FeeParametersUpdated(uint256 feePercentage, uint256 minFee, uint256 maxFee);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);
    event MessageBusUpdated(address indexed newMessageBus);

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
        __UUPSUpgradeable_init();
        // RateLimiter initialization removed
        
        require(_messageBus != address(0), "CelerIM: invalid message bus");
        require(_lookCoin != address(0), "CelerIM: invalid LookCoin");
        
        lookCoin = ILookCoin(_lookCoin);
        messageBus = IMessageBus(_messageBus);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        // Rate limit admin role removed
        
        // Initialize defaults
        feePercentage = 50; // 0.5%
        minFee = 10 * 10**lookCoin.decimals();
        maxFee = 1000 * 10**lookCoin.decimals();
        feeCollector = _admin;
        
        // Rate limit configuration removed for now
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
    ) external payable 
        whenNotPaused 
        nonReentrant
        // Rate limiting check removed
    {
        require(!blacklist[msg.sender], "CelerIM: sender blacklisted");
        require(whitelist[msg.sender] || !paused(), "CelerIM: not whitelisted");
        require(_recipient != address(0), "CelerIM: invalid recipient");
        require(_amount > 0, "CelerIM: invalid amount");
        require(remoteModules[_dstChainId] != address(0), "CelerIM: unsupported chain");
        require(
            _dstChainId == BSC_CHAINID || 
            _dstChainId == OPTIMISM_CHAINID || 
            _dstChainId == SAPPHIRE_CHAINID,
            "CelerIM: invalid destination chain"
        );
        
        // Calculate fee
        uint256 fee = calculateFee(_amount);
        uint256 netAmount = _amount - fee;
        
        // Lock tokens
        IERC20(address(lookCoin)).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Transfer fee to collector
        if (fee > 0) {
            IERC20(address(lookCoin)).safeTransfer(feeCollector, fee);
        }
        
        // Generate unique transfer ID
        bytes32 transferId = keccak256(
            abi.encodePacked(msg.sender, _recipient, _amount, block.timestamp, block.number)
        );
        
        // Encode message
        bytes memory message = abi.encode(
            msg.sender,
            _recipient,
            netAmount,
            transferId
        );
        
        // Calculate Celer message fee
        uint256 messageFee = estimateMessageFee(_dstChainId, message);
        require(msg.value >= messageFee, "CelerIM: insufficient message fee");
        
        // Send cross-chain message with transfer
        messageBus.sendMessageWithTransfer{value: messageFee}(
            remoteModules[_dstChainId],
            _dstChainId,
            message,
            address(lookCoin),
            transferId,
            messageFee
        );
        
        // Refund excess ETH
        if (msg.value > messageFee) {
            payable(msg.sender).transfer(msg.value - messageFee);
        }
        
        emit CrossChainTransferLocked(msg.sender, _dstChainId, _recipient, netAmount, fee, transferId);
    }

    /**
     * @dev Execute incoming cross-chain message and mint tokens
     * @param _sender Sender address on source chain
     * @param _token Token address (should be address(0) for mint)
     * @param _amount Amount (not used for mint)
     * @param _srcChainId Source chain ID
     * @param _message Encoded message data
     * @param _executor Executor address
     */
    function executeMessageWithTransfer(
        address _sender,
        address _token,
        uint256 _amount,
        uint64 _srcChainId,
        bytes memory _message,
        address _executor
    ) external payable override whenNotPaused returns (ExecutionStatus) {
        require(msg.sender == address(messageBus), "CelerIM: unauthorized caller");
        require(_sender == remoteModules[_srcChainId], "CelerIM: unauthorized sender");
        
        // Decode message
        (
            address originalSender,
            address recipient,
            uint256 mintAmount,
            bytes32 transferId
        ) = abi.decode(_message, (address, address, uint256, bytes32));
        
        // Check for duplicate processing
        require(!processedTransfers[transferId], "CelerIM: transfer already processed");
        processedTransfers[transferId] = true;
        
        require(!blacklist[recipient], "CelerIM: recipient blacklisted");
        
        // Rate limiting check removed for incoming transfers
        
        // Mint tokens to recipient
        lookCoin.mint(recipient, mintAmount);
        
        emit CrossChainTransferMinted(_srcChainId, originalSender, recipient, mintAmount, transferId);
        
        return ExecutionStatus.Success;
    }

    /**
     * @dev Handle message execution failure with refund
     * @param _token Token address
     * @param _amount Refund amount
     * @param _message Original message
     * @param _executor Executor address
     */
    function executeMessageWithTransferRefund(
        address _token,
        uint256 _amount,
        bytes calldata _message,
        address _executor
    ) external payable override returns (ExecutionStatus) {
        require(msg.sender == address(messageBus), "CelerIM: unauthorized caller");
        
        // Decode original message to get sender
        (address originalSender, , , ) = abi.decode(_message, (address, address, uint256, bytes32));
        
        // Refund tokens to original sender
        if (_token == address(lookCoin) && _amount > 0) {
            IERC20(_token).safeTransfer(originalSender, _amount);
        }
        
        return ExecutionStatus.Success;
    }

    /**
     * @dev Estimate message fee for cross-chain transfer
     * @param _dstChainId Destination chain ID
     * @param _message Message to send
     * @return fee Estimated fee in native token
     */
    function estimateMessageFee(
        uint64 _dstChainId,
        bytes memory _message
    ) public view returns (uint256 fee) {
        fee = messageBus.feeBase() + (messageBus.feePerByte() * _message.length);
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
        require(
            _chainId == BSC_CHAINID || 
            _chainId == OPTIMISM_CHAINID || 
            _chainId == SAPPHIRE_CHAINID,
            "CelerIM: unsupported chain"
        );
        remoteModules[_chainId] = _module;
        emit RemoteModuleSet(_chainId, _module);
    }

    /**
     * @dev Update MessageBus address
     * @param _messageBus New MessageBus address
     */
    function updateMessageBus(address _messageBus) external onlyRole(ADMIN_ROLE) {
        require(_messageBus != address(0), "CelerIM: invalid message bus");
        messageBus = IMessageBus(_messageBus);
        emit MessageBusUpdated(_messageBus);
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
     * @dev Update fee collector address
     * @param _feeCollector New fee collector address
     */
    function updateFeeCollector(address _feeCollector) external onlyRole(ADMIN_ROLE) {
        require(_feeCollector != address(0), "CelerIM: invalid fee collector");
        feeCollector = _feeCollector;
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

    /**
     * @dev Authorize upgrade for UUPS proxy
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(ADMIN_ROLE)
    {}
}