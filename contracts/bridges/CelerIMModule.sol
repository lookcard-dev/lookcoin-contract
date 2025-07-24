// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../interfaces/ILookCoin.sol";

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
 * @dev Celer IM bridge module for LookCoin cross-chain transfers using burn-and-mint mechanism
 * @notice This contract handles cross-chain token transfers between BSC, Optimism, and Sapphire chains
 * @dev Security features include role-based access control, pausability, reentrancy protection, and transfer replay prevention
 */
contract CelerIMModule is
  AccessControlUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  UUPSUpgradeable,
  IMessageReceiverApp,
  ILookBridgeModule
{
  using SafeERC20 for IERC20;

  // Role definitions
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

  // State variables
  /// @dev LookCoin contract interface for minting tokens
  ILookCoin public lookCoin;
  /// @dev Celer MessageBus interface for cross-chain messaging
  IMessageBus public messageBus;
  /// @dev Mapping from chain ID to remote module addresses for cross-chain communication
  mapping(uint64 => address) public remoteModules;
  /// @dev Whitelist of addresses allowed to use bridge during maintenance
  mapping(address => bool) public whitelist;
  /// @dev Blacklist of addresses banned from using the bridge
  mapping(address => bool) public blacklist;
  /// @dev Mapping to track processed transfers to prevent replay attacks
  mapping(bytes32 => bool) public processedTransfers;
  /// @dev Mapping to store transfer details for ILookBridgeModule compatibility
  mapping(bytes32 => BridgeTransfer) public transfers;

  // Fee parameters
  /// @dev Bridge fee percentage in basis points (100 = 1%)
  uint256 public feePercentage;
  /// @dev Minimum fee amount regardless of transfer size
  uint256 public minFee;
  /// @dev Maximum fee amount to cap large transfers
  uint256 public maxFee;
  /// @dev Address that collects bridge fees
  address public feeCollector;

  // New storage variables (added for upgrade compatibility)
  /// @dev Mapping of supported chains (configured via setSupportedChain)
  mapping(uint64 => bool) public supportedChains;

  // Events
  /// @notice Emitted when tokens are locked for cross-chain transfer
  /// @param sender Address that initiated the transfer
  /// @param dstChainId Destination chain ID
  /// @param recipient Recipient address on destination chain
  /// @param amount Net amount being transferred (after fees)
  /// @param fee Fee amount collected
  /// @param transferId Unique transfer identifier
  event CrossChainTransferInitiated(
    address indexed sender,
    uint64 indexed dstChainId,
    address indexed recipient,
    uint256 amount,
    uint256 fee,
    bytes32 transferId
  );

  /// @notice Emitted when tokens are minted from cross-chain transfer
  /// @param srcChainId Source chain ID where tokens were locked
  /// @param sender Original sender address on source chain
  /// @param recipient Recipient address receiving minted tokens
  /// @param amount Amount of tokens minted
  /// @param transferId Unique transfer identifier
  event CrossChainTransferMinted(
    uint64 indexed srcChainId,
    address indexed sender,
    address indexed recipient,
    uint256 amount,
    bytes32 transferId
  );

  /// @notice Emitted when a remote module address is configured
  /// @param chainId Chain ID of the remote module
  /// @param module Address of the remote module
  event RemoteModuleSet(uint64 indexed chainId, address module);

  /// @notice Emitted when fee parameters are updated
  /// @param feePercentage New fee percentage in basis points
  /// @param minFee New minimum fee amount
  /// @param maxFee New maximum fee amount
  event FeeParametersUpdated(uint256 feePercentage, uint256 minFee, uint256 maxFee);

  /// @notice Emitted when emergency withdrawal is performed
  /// @param token Token address (address(0) for native token)
  /// @param to Recipient address
  /// @param amount Amount withdrawn
  event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

  /// @notice Emitted when MessageBus address is updated
  /// @param newMessageBus New MessageBus contract address
  event MessageBusUpdated(address indexed newMessageBus);

  /// @notice Emitted when a chain's support status is updated
  /// @param chainId Chain ID that was updated
  /// @param supported Whether the chain is now supported
  event SupportedChainUpdated(uint64 indexed chainId, bool supported);

  /// @notice Emitted when a transfer fails and cannot be refunded (burn-and-mint)
  /// @param transferId Unique transfer identifier
  /// @param sender Original sender address
  /// @param recipient Intended recipient address
  /// @param amount Amount that was burned
  /// @param reason Failure reason
  event TransferFailed(bytes32 indexed transferId, address indexed sender, address indexed recipient, uint256 amount, string reason);

  /**
   * @dev Initialize the Celer IM module
   * @param _lookCoin LookCoin contract address for token operations
   * @param _messageBus Celer MessageBus address for cross-chain messaging
   * @param _admin Admin address to be granted all administrative roles
   * @notice Sets up the bridge with default fee parameters and role assignments
   * @dev Fee defaults: 0.5% (50 basis points), min 10 LOOK, max 1000 LOOK
   */
  function initialize(address _messageBus, address _lookCoin, address _admin) public initializer {
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
    minFee = 10 * 10 ** 18; // 10 LOOK (assuming 18 decimals)
    maxFee = 1000 * 10 ** 18; // 1000 LOOK (assuming 18 decimals)
    feeCollector = _admin;

    // Note: Supported chains are now configured via setSupportedChain() after deployment
    // This allows for flexible chain support without hardcoded values
  }

  /**
   * @dev Burn LOOK tokens and initiate cross-chain transfer
   * @param _dstChainId Destination chain ID (must be BSC, Optimism, or Sapphire)
   * @param _recipient Recipient address on destination chain
   * @param _amount Amount to transfer (before fees)
   * @notice Burns tokens on source chain and sends message to mint on destination
   * @dev Requires msg.value to cover Celer message fees
   * @dev Emits CrossChainTransferInitiated event
   */
  function bridge(
    uint64 _dstChainId,
    address _recipient,
    uint256 _amount
  )
    external
    payable
    whenNotPaused
    nonReentrant // Rate limiting check removed
  {
    require(!blacklist[msg.sender], "CelerIM: sender blacklisted");
    require(whitelist[msg.sender] || !paused(), "CelerIM: not whitelisted");
    require(_recipient != address(0), "CelerIM: invalid recipient");
    require(_amount > 0, "CelerIM: invalid amount");
    require(remoteModules[_dstChainId] != address(0), "CelerIM: unsupported chain");
    require(supportedChains[_dstChainId], "CelerIM: unsupported destination chain");

    // Calculate fee
    uint256 fee = calculateFee(_amount);
    uint256 netAmount = _amount - fee;

    // Burn tokens (including fee)
    lookCoin.burn(msg.sender, _amount);

    // Note: Fee collection happens on destination chain during minting

    // Generate unique transfer ID
    bytes32 transferId = keccak256(abi.encodePacked(msg.sender, _recipient, _amount, block.timestamp, block.number));

    // Encode message
    bytes memory message = abi.encode(msg.sender, _recipient, netAmount, transferId);

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

    emit CrossChainTransferInitiated(msg.sender, _dstChainId, _recipient, netAmount, fee, transferId);
  }

  /**
   * @dev ILookBridgeModule implementation - bridge tokens to another chain
   * @param destinationChain Destination chain ID
   * @param recipient Recipient address on destination chain
   * @param amount Amount to transfer
   * @param params Additional parameters (unused for Celer)
   * @return transferId Unique transfer identifier
   */
  function bridgeToken(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
  ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
    // Call existing bridge functionality
    uint64 dstChainId = uint64(destinationChain);

    // Calculate fee
    uint256 fee = calculateFee(amount);
    uint256 netAmount = amount - fee;

    // Generate transfer ID
    transferId = keccak256(abi.encodePacked(msg.sender, recipient, amount, block.timestamp, block.number));

    // Store transfer info for ILookBridgeModule
    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: msg.sender,
      recipient: recipient,
      amount: amount,
      sourceChain: block.chainid,
      destinationChain: destinationChain,
      protocol: "Celer",
      status: TransferStatus.Pending,
      timestamp: block.timestamp
    });

    // Execute the bridge operation
    this.bridge{value: msg.value}(dstChainId, recipient, amount);

    emit TransferInitiated(transferId, msg.sender, destinationChain, amount, "Celer");
  }

  /**
   * @dev ILookBridgeModule implementation - handle incoming transfer
   * @param sourceChain Source chain ID
   * @param sender Sender address on source chain
   * @param recipient Recipient address on this chain
   * @param amount Amount to transfer
   * @param data Additional data
   */
  function handleIncoming(
    uint256 sourceChain,
    address sender,
    address recipient,
    uint256 amount,
    bytes calldata data
  ) external override {
    // This is handled by executeMessageWithTransfer
    revert("Use executeMessageWithTransfer for Celer incoming transfers");
  }

  /**
   * @dev ILookBridgeModule implementation - estimate transfer fee
   * @param destinationChain Destination chain ID
   * @param amount Transfer amount
   * @param params Additional parameters
   * @return fee Estimated fee
   * @return estimatedTime Estimated transfer time in seconds
   */
  function estimateFee(
    uint256 destinationChain,
    uint256 amount,
    bytes calldata params
  ) external view override returns (uint256 fee, uint256 estimatedTime) {
    fee = calculateFee(amount);

    // Add Celer message fee
    uint256 messageFee = messageBus.feeBase() + (200 * messageBus.feePerByte());
    fee += messageFee;

    // Celer transfers typically take 5-10 minutes
    estimatedTime = 300;
  }

  /**
   * @dev ILookBridgeModule implementation - get transfer status
   * @param transferId Transfer identifier
   * @return status Current transfer status
   */
  function getStatus(bytes32 transferId) external view override returns (TransferStatus) {
    return transfers[transferId].status;
  }

  /**
   * @dev ILookBridgeModule implementation - update module configuration
   * @param config Encoded configuration data
   */
  function updateConfig(bytes calldata config) external override onlyRole(ADMIN_ROLE) {
    // Decode and apply configuration
    (uint256 newFeePercentage, uint256 newMinFee, uint256 newMaxFee) = abi.decode(config, (uint256, uint256, uint256));

    if (newFeePercentage > 0) {
      require(newFeePercentage <= 1000, "CelerIM: fee too high"); // Max 10%
      require(newMinFee <= newMaxFee, "CelerIM: invalid fee range");

      feePercentage = newFeePercentage;
      minFee = newMinFee;
      maxFee = newMaxFee;

      emit FeeParametersUpdated(newFeePercentage, newMinFee, newMaxFee);
    }
  }

  /**
   * @dev ILookBridgeModule implementation - pause the module
   */
  function pause() external override onlyRole(ADMIN_ROLE) {
    _pause();
    emit ProtocolStatusChanged(ProtocolStatus.Paused);
  }

  /**
   * @dev ILookBridgeModule implementation - unpause the module
   */
  function unpause() external override onlyRole(ADMIN_ROLE) {
    _unpause();
    emit ProtocolStatusChanged(ProtocolStatus.Active);
  }

  /**
   * @dev ILookBridgeModule implementation - emergency withdrawal
   * @param token Token address (0 for native)
   * @param to Recipient address
   * @param amount Amount to withdraw
   * @notice Only for native tokens or accidentally sent tokens, not for LookCoin (which is burned)
   */
  function emergencyWithdraw(address token, address to, uint256 amount) external override onlyRole(ADMIN_ROLE) {
    require(token != address(lookCoin), "CelerIM: cannot withdraw LookCoin");
    
    if (token == address(0)) {
      payable(to).transfer(amount);
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
    emit EmergencyWithdraw(token, to, amount);
  }

  /**
   * @dev Execute incoming cross-chain message and mint tokens
   * @param _sender Sender address on source chain (must be registered remote module)
   * @param _token Token address (unused for mint operations)
   * @param _amount Amount (unused, actual amount is in message)
   * @param _srcChainId Source chain ID where tokens were locked
   * @param _message Encoded message containing transfer details
   * @param _executor Executor address (unused)
   * @notice Called by MessageBus to process incoming cross-chain transfers
   * @dev Validates sender, prevents replay attacks, and mints tokens to recipient
   * @return ExecutionStatus indicating success or failure
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
    (address originalSender, address recipient, uint256 mintAmount, bytes32 transferId) = abi.decode(
      _message,
      (address, address, uint256, bytes32)
    );

    // Check for duplicate processing
    require(!processedTransfers[transferId], "CelerIM: transfer already processed");
    processedTransfers[transferId] = true;

    require(!blacklist[recipient], "CelerIM: recipient blacklisted");

    // Rate limiting check removed for incoming transfers

    // Mint tokens to recipient
    lookCoin.mint(recipient, mintAmount);

    // Update transfer status for ILookBridgeModule
    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: originalSender,
      recipient: recipient,
      amount: mintAmount,
      sourceChain: uint256(_srcChainId),
      destinationChain: block.chainid,
      protocol: "Celer",
      status: TransferStatus.Completed,
      timestamp: block.timestamp
    });

    emit CrossChainTransferMinted(_srcChainId, originalSender, recipient, mintAmount, transferId);
    emit TransferCompleted(transferId, recipient, mintAmount);

    return ExecutionStatus.Success;
  }

  /**
   * @dev Handle message execution failure with refund
   * @param _token Token address for refund (unused)
   * @param _amount Refund amount (unused)
   * @param _message Original message to decode sender information
   * @param _executor Executor address (unused)
   * @notice Called by MessageBus when cross-chain transfer fails
   * @dev Since we use burn-and-mint, tokens cannot be refunded (they're already burned)
   * @return ExecutionStatus indicating acknowledgment
   */
  function executeMessageWithTransferRefund(
    address _token,
    uint256 _amount,
    bytes calldata _message,
    address _executor
  ) external payable override returns (ExecutionStatus) {
    require(msg.sender == address(messageBus), "CelerIM: unauthorized caller");

    // Decode original message to log the failure
    (address originalSender, address recipient, uint256 burnedAmount, bytes32 transferId) = abi.decode(_message, (address, address, uint256, bytes32));

    // Since tokens were burned, we cannot refund. Log the failure.
    // In production, you might want to implement a recovery mechanism
    emit TransferFailed(transferId, originalSender, recipient, burnedAmount, "Cannot refund burned tokens");

    return ExecutionStatus.Success;
  }

  /**
   * @dev Estimate message fee for cross-chain transfer
   * @param _dstChainId Destination chain ID
   * @param _message Message to send
   * @return fee Estimated fee in native token (ETH/BNB)
   * @notice Calculates Celer messaging fee based on message size
   * @dev Fee = base fee + (per-byte fee * message length)
   */
  function estimateMessageFee(uint64 _dstChainId, bytes memory _message) public view returns (uint256 fee) {
    fee = messageBus.feeBase() + (messageBus.feePerByte() * _message.length);
  }

  /**
   * @dev Calculate transfer fee
   * @param _amount Transfer amount
   * @return fee Fee amount in LOOK tokens
   * @notice Applies percentage fee with min/max bounds
   * @dev Fee calculation: max(minFee, min(maxFee, amount * feePercentage / 10000))
   */
  function calculateFee(uint256 _amount) public view returns (uint256 fee) {
    fee = (_amount * feePercentage) / 10000;
    if (fee < minFee) fee = minFee;
    if (fee > maxFee) fee = maxFee;
  }

  /**
   * @dev Set remote module address for a chain
   * @param _chainId Chain ID for the remote chain
   * @param _module Module address on the remote chain
   * @notice Registers trusted remote module for cross-chain communication
   * @dev Only supported chains are allowed to prevent misconfiguration
   */
  function setRemoteModule(uint64 _chainId, address _module) external onlyRole(ADMIN_ROLE) {
    require(supportedChains[_chainId], "CelerIM: unsupported chain");
    remoteModules[_chainId] = _module;
    emit RemoteModuleSet(_chainId, _module);
  }

  /**
   * @dev Add or remove a supported chain
   * @param _chainId Chain ID to configure
   * @param _supported Whether the chain is supported
   * @notice Configures which chains this module can bridge to/from
   * @dev Must be called after deployment to enable cross-chain operations
   */
  function setSupportedChain(uint64 _chainId, bool _supported) external onlyRole(ADMIN_ROLE) {
    supportedChains[_chainId] = _supported;
    emit SupportedChainUpdated(_chainId, _supported);
  }

  /**
   * @dev Update MessageBus address
   * @param _messageBus New MessageBus address
   * @notice Updates Celer MessageBus contract address
   * @dev Critical operation that affects all cross-chain functionality
   */
  function updateMessageBus(address _messageBus) external onlyRole(ADMIN_ROLE) {
    require(_messageBus != address(0), "CelerIM: invalid message bus");
    messageBus = IMessageBus(_messageBus);
    emit MessageBusUpdated(_messageBus);
  }

  /**
   * @dev Update fee parameters
   * @param _feePercentage New fee percentage in basis points (max 1000 = 10%)
   * @param _minFee New minimum fee in LOOK tokens
   * @param _maxFee New maximum fee in LOOK tokens
   * @notice Adjusts bridge fee structure
   * @dev Ensures fee percentage doesn't exceed 10% and min <= max
   */
  function updateFeeParameters(uint256 _feePercentage, uint256 _minFee, uint256 _maxFee) external onlyRole(ADMIN_ROLE) {
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
   * @notice Changes the address that receives bridge fees
   * @dev Cannot be set to zero address
   */
  function updateFeeCollector(address _feeCollector) external onlyRole(ADMIN_ROLE) {
    require(_feeCollector != address(0), "CelerIM: invalid fee collector");
    feeCollector = _feeCollector;
  }

  /**
   * @dev Add/remove address from whitelist
   * @param _address Address to update
   * @param _whitelisted Whitelist status (true to add, false to remove)
   * @notice Whitelisted addresses can use bridge even when paused
   * @dev Useful for maintenance and emergency operations
   */
  function updateWhitelist(address _address, bool _whitelisted) external onlyRole(OPERATOR_ROLE) {
    whitelist[_address] = _whitelisted;
  }

  /**
   * @dev Add/remove address from blacklist
   * @param _address Address to update
   * @param _blacklisted Blacklist status (true to ban, false to unban)
   * @notice Blacklisted addresses cannot use the bridge
   * @dev Takes precedence over whitelist
   */
  function updateBlacklist(address _address, bool _blacklisted) external onlyRole(OPERATOR_ROLE) {
    blacklist[_address] = _blacklisted;
  }

  /**
   * @dev Override supportsInterface for multiple inheritance
   * @notice Required for AccessControl compatibility
   */
  function supportsInterface(bytes4 interfaceId) public view override(AccessControlUpgradeable) returns (bool) {
    return super.supportsInterface(interfaceId);
  }

  /**
   * @dev Authorize upgrade for UUPS proxy
   * @param newImplementation New implementation address
   * @notice Restricts upgrades to ADMIN_ROLE only
   * @dev Critical security function for upgrade control
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
