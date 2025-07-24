// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMessageRecipient.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IInterchainGasPaymaster.sol";
import "./interfaces/ICrossChainRouter.sol";

// LayerZero interfaces
interface ILayerZeroEndpoint {
  function send(
    uint16 _dstChainId,
    bytes calldata _destination,
    bytes calldata _payload,
    address payable _refundAddress,
    address _zroPaymentAddress,
    bytes calldata _adapterParams
  ) external payable;

  function receivePayload(
    uint16 _srcChainId,
    bytes calldata _srcAddress,
    address _dstAddress,
    uint64 _nonce,
    uint _gasLimit,
    bytes calldata _payload
  ) external;

  function estimateFees(
    uint16 _dstChainId,
    address _userApplication,
    bytes calldata _payload,
    bool _payInZRO,
    bytes calldata _adapterParam
  ) external view returns (uint nativeFee, uint zroFee);

  function getInboundNonce(uint16 _srcChainId, bytes calldata _srcAddress) external view returns (uint64);

  function getOutboundNonce(uint16 _dstChainId, address _srcAddress) external view returns (uint64);
}

interface ILayerZeroReceiver {
  function lzReceive(uint16 _srcChainId, bytes calldata _srcAddress, uint64 _nonce, bytes calldata _payload) external;
}

/**
 * @title LookCoin
 * @dev Native multi-protocol cross-chain token with LayerZero OFT V2 and Hyperlane support
 * @notice LookCoin (LOOK) is the primary payment method for LookCard's crypto-backed credit/debit card system
 */
contract LookCoin is
  ERC20Upgradeable,
  UUPSUpgradeable,
  AccessControlUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  ILayerZeroReceiver,
  IMessageRecipient
{
  // Role definitions
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
  bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
  bytes32 public constant PROTOCOL_ADMIN_ROLE = keccak256("PROTOCOL_ADMIN_ROLE");
  bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");

  // LayerZero OFT v2 constants
  uint16 internal constant PT_SEND = 0; // Packet type for standard transfer

  // LayerZero integration state
  /// @dev LayerZero endpoint address for cross-chain messaging
  ILayerZeroEndpoint public lzEndpoint;
  /// @dev Mapping from chain ID to trusted remote contract addresses
  mapping(uint16 => bytes32) public trustedRemoteLookup;
  /// @dev Gas limit for destination chain execution
  uint public gasForDestinationLzReceive;
  /// @dev Mapping to track processed nonces per source chain
  mapping(uint16 => mapping(uint64 => bool)) public processedNonces;

  // Supply tracking
  /// @dev Total amount of tokens minted across all operations
  uint256 public totalMinted;
  /// @dev Total amount of tokens burned across all operations
  uint256 public totalBurned;

  // Multi-protocol support
  /// @dev Cross-chain router for unified bridge operations
  ICrossChainRouter public crossChainRouter;
  /// @dev Hyperlane mailbox address for message passing
  address public hyperlaneMailbox;
  /// @dev Hyperlane interchain gas paymaster
  IInterchainGasPaymaster public hyperlaneGasPaymaster;
  /// @dev Mapping of supported Hyperlane domains
  mapping(uint32 => bool) public supportedHyperlaneDomains;


  // Storage gap for future upgrades
  uint256[46] private __gap;

  // Events
  /// @notice Emitted when the contract is paused for emergency
  /// @param by Address that triggered the pause
  event EmergencyPause(address indexed by);

  /// @notice Emitted when the contract is unpaused after emergency
  /// @param by Address that triggered the unpause
  event EmergencyUnpause(address indexed by);

  /// @notice Emitted when a cross-chain transfer is initiated
  /// @param from Sender address on the source chain
  /// @param dstChainId Destination chain ID
  /// @param toAddress Recipient address on destination chain (encoded)
  /// @param amount Amount of tokens being transferred
  event CrossChainTransferInitiated(
    address indexed from,
    uint16 indexed dstChainId,
    bytes indexed toAddress,
    uint256 amount
  );

  /// @notice Emitted when tokens are received from another chain
  /// @param srcChainId Source chain ID where tokens originated
  /// @param fromAddress Sender address on source chain (encoded)
  /// @param to Recipient address on this chain
  /// @param amount Amount of tokens received
  event CrossChainTransferReceived(
    uint16 indexed srcChainId,
    bytes indexed fromAddress,
    address indexed to,
    uint256 amount
  );

  /// @notice Emitted when DVN (Decentralized Verifier Network) is configured for LayerZero
  /// @param dvns Array of DVN addresses
  /// @param requiredDVNs Number of required DVN validations
  /// @param optionalDVNs Number of optional DVN validations
  /// @param threshold Percentage threshold for validation consensus
  event DVNConfigured(address[] dvns, uint8 requiredDVNs, uint8 optionalDVNs, uint8 threshold);

  /// @notice Emitted when a peer contract is connected on another chain
  /// @param chainId Chain ID of the connected peer
  /// @param peer Address of the peer contract on the other chain
  event PeerConnected(uint16 indexed chainId, bytes32 indexed peer);

  /// @notice Emitted when the LayerZero endpoint is set or updated
  /// @param endpoint New LayerZero endpoint address
  event LayerZeroEndpointSet(address indexed endpoint);


  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @dev Initialize the contract with token parameters
   * @param _admin Address to be granted admin role
   * @param _lzEndpoint LayerZero endpoint address (can be zero for non-LZ chains)
   */
  function initialize(address _admin, address _lzEndpoint) public initializer {
    __ERC20_init("LookCoin", "LOOK");
    __UUPSUpgradeable_init();
    __AccessControl_init();
    __Pausable_init();
    __ReentrancyGuard_init();

    // Initialize gas for LayerZero
    gasForDestinationLzReceive = 350000;

    // Grant roles
    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(PAUSER_ROLE, _admin);
    _grantRole(UPGRADER_ROLE, _admin);
    _grantRole(PROTOCOL_ADMIN_ROLE, _admin);
    _grantRole(ROUTER_ADMIN_ROLE, _admin);

    // Set LayerZero endpoint if provided
    if (_lzEndpoint != address(0)) {
      lzEndpoint = ILayerZeroEndpoint(_lzEndpoint);
      emit LayerZeroEndpointSet(_lzEndpoint);
    }
  }

  /**
   * @dev Mint tokens to address. Only role-based minting supported
   * @param to Address to mint tokens to
   * @param amount Amount to mint
   */
  function mint(address to, uint256 amount) public whenNotPaused nonReentrant {
    require(to != address(0), "LookCoin: mint to zero address");
    require(
      hasRole(MINTER_ROLE, msg.sender) ||
        hasRole(BRIDGE_ROLE, msg.sender),
      "LookCoin: unauthorized minter"
    );

    totalMinted += amount;
    _mint(to, amount);
  }

  /**
   * @dev Burn tokens from address. Only role-based burning supported
   * @param from Address to burn tokens from
   * @param amount Amount to burn
   */
  function burn(address from, uint256 amount) public whenNotPaused nonReentrant {
    require(from != address(0), "LookCoin: burn from zero address");
    require(
      hasRole(BURNER_ROLE, msg.sender) ||
        hasRole(BRIDGE_ROLE, msg.sender) ||
        (from == msg.sender), // Allow self-burn
      "LookCoin: unauthorized burner"
    );

    totalBurned += amount;
    _burn(from, amount);
  }

  /**
   * @dev Bridge function for cross-chain transfers - delegates to CrossChainRouter
   * @param _dstChainId Destination chain ID
   * @param _toAddress Recipient address on destination chain (encoded as bytes)
   * @param _amount Amount to transfer
   * @notice This function is maintained for backward compatibility
   * @dev Delegates to CrossChainRouter for protocol selection and execution
   */
  function bridgeToken(
    uint16 _dstChainId,
    bytes calldata _toAddress,
    uint256 _amount
  ) external payable whenNotPaused nonReentrant {
    require(_amount > 0, "LookCoin: invalid amount");
    require(_toAddress.length > 0, "LookCoin: invalid recipient");

    if (address(crossChainRouter) != address(0)) {
      // Decode recipient address from bytes
      address recipient;
      if (_toAddress.length == 20) {
        recipient = abi.decode(_toAddress, (address));
      } else {
        revert("LookCoin: invalid recipient format");
      }

      // Approve router to spend tokens
      _approve(msg.sender, address(crossChainRouter), _amount);

      // Delegate to router for optimal protocol selection
      crossChainRouter.bridgeToken{value: msg.value}(
        uint256(_dstChainId),
        recipient,
        _amount,
        ICrossChainRouter.Protocol.LayerZero, // Default to LayerZero for compatibility
        _toAddress
      );
    } else {
      // Fallback to direct LayerZero if router not configured
      require(address(lzEndpoint) != address(0), "LookCoin: LayerZero not configured");
      require(trustedRemoteLookup[_dstChainId] != bytes32(0), "LookCoin: destination not trusted");

      // Burn tokens on source chain
      totalBurned += _amount;
      _burn(msg.sender, _amount);

      // Encode OFT v2 payload
      bytes memory payload = abi.encode(
        PT_SEND, // Packet type for OFT transfer
        msg.sender, // Sender address
        _toAddress, // Recipient address (bytes)
        _amount // Amount to transfer
      );

      // Prepare adapter parameters for gas on destination
      bytes memory adapterParams = abi.encodePacked(
        uint16(1), // Version 1
        gasForDestinationLzReceive // Gas for destination execution
      );

      // Get the trusted remote address
      bytes memory trustedRemote = abi.encodePacked(trustedRemoteLookup[_dstChainId], address(this));

      // Send via LayerZero
      lzEndpoint.send{value: msg.value}(
        _dstChainId, // Destination chain ID
        trustedRemote, // Remote contract address
        payload, // Encoded payload
        payable(msg.sender), // Refund address
        address(0), // ZRO payment address (not used)
        adapterParams // Adapter parameters
      );

      emit CrossChainTransferInitiated(msg.sender, _dstChainId, _toAddress, _amount);
    }
  }

  /**
   * @dev Bridge tokens to another chain using Hyperlane
   * @param destinationDomain Hyperlane domain ID of the destination chain
   * @param recipient Recipient address on the destination chain
   * @param amount Amount of tokens to bridge
   */
  function bridgeTokenHyperlane(
    uint32 destinationDomain,
    address recipient,
    uint256 amount
  ) external payable whenNotPaused nonReentrant {
    require(hyperlaneMailbox != address(0), "LookCoin: Hyperlane not configured");
    require(supportedHyperlaneDomains[destinationDomain], "LookCoin: unsupported domain");
    require(recipient != address(0), "LookCoin: invalid recipient");
    require(amount > 0, "LookCoin: amount must be greater than 0");

    // Burn tokens from sender
    _burn(msg.sender, amount);

    // Encode the message
    bytes memory messageBody = abi.encode(recipient, amount);

    // Convert recipient address to bytes32 for Hyperlane
    bytes32 recipientBytes32 = bytes32(uint256(uint160(recipient)));

    // Dispatch the message via Hyperlane
    bytes32 messageId = IMailbox(hyperlaneMailbox).dispatch(destinationDomain, recipientBytes32, messageBody);

    // Pay for gas if gas paymaster is configured
    if (address(hyperlaneGasPaymaster) != address(0) && msg.value > 0) {
      // Quote gas payment (if needed)
      uint256 gasAmount = 500000; // Default gas amount, can be made configurable

      // Pay for gas
      hyperlaneGasPaymaster.payForGas{value: msg.value}(
        messageId,
        destinationDomain,
        gasAmount,
        msg.sender // refund address
      );
    }

    // Emit event using existing event structure
    emit CrossChainTransferInitiated(
      msg.sender,
      uint16(destinationDomain), // Cast to uint16 for compatibility
      abi.encodePacked(recipient),
      amount
    );
  }

  /**
   * @dev LayerZero receiver function to handle incoming cross-chain transfers
   * @param _srcChainId Source chain ID
   * @param _srcAddress Source contract address (encoded)
   * @param _nonce Message nonce
   * @param _payload Encoded transfer data
   * @notice Called by LayerZero endpoint to process incoming transfers
   * @dev Implements ILayerZeroReceiver interface
   */
  function lzReceive(
    uint16 _srcChainId,
    bytes calldata _srcAddress,
    uint64 _nonce,
    bytes calldata _payload
  ) external override whenNotPaused {
    require(msg.sender == address(lzEndpoint), "LookCoin: invalid endpoint caller");

    // Verify trusted source
    bytes32 srcAddressBytes32;
    assembly {
      srcAddressBytes32 := calldataload(add(_srcAddress.offset, 0))
    }
    require(srcAddressBytes32 == trustedRemoteLookup[_srcChainId], "LookCoin: source not trusted");

    // Prevent replay attacks
    require(!processedNonces[_srcChainId][_nonce], "LookCoin: nonce already processed");
    processedNonces[_srcChainId][_nonce] = true;

    // Decode payload
    (uint16 packetType, address sender, bytes memory toAddressBytes, uint256 amount) = abi.decode(
      _payload,
      (uint16, address, bytes, uint256)
    );

    require(packetType == PT_SEND, "LookCoin: invalid packet type");

    // Decode recipient address
    address toAddress;
    assembly {
      toAddress := mload(add(toAddressBytes, 20))
    }

    require(toAddress != address(0), "LookCoin: mint to zero address");

    // Mint tokens to recipient
    totalMinted += amount;
    _mint(toAddress, amount);

    emit CrossChainTransferReceived(_srcChainId, abi.encodePacked(sender), toAddress, amount);
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
   * @notice Updates the LayerZero endpoint for cross-chain messaging
   * @dev Critical function that affects all LayerZero operations
   */
  function setLayerZeroEndpoint(address _endpoint) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_endpoint != address(0), "LookCoin: invalid endpoint");
    lzEndpoint = ILayerZeroEndpoint(_endpoint);
    emit LayerZeroEndpointSet(_endpoint);
  }

  /**
   * @dev Set gas limit for destination chain execution
   * @param _gasLimit New gas limit
   * @notice Adjusts gas sent for lzReceive execution on destination chain
   */
  function setGasForDestinationLzReceive(uint _gasLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_gasLimit > 0 && _gasLimit < 1000000, "LookCoin: invalid gas limit");
    gasForDestinationLzReceive = _gasLimit;
  }

  /**
   * @dev Estimate fees for cross-chain transfer
   * @param _dstChainId Destination chain ID
   * @param _toAddress Recipient address (encoded)
   * @param _amount Amount to transfer
   * @return nativeFee Fee in native token (ETH/BNB)
   * @return zroFee Fee in ZRO token (if applicable)
   */
  function estimateBridgeFee(
    uint16 _dstChainId,
    bytes calldata _toAddress,
    uint256 _amount
  ) external view returns (uint nativeFee, uint zroFee) {
    require(address(lzEndpoint) != address(0), "LookCoin: LayerZero not configured");

    bytes memory payload = abi.encode(PT_SEND, msg.sender, _toAddress, _amount);
    bytes memory adapterParams = abi.encodePacked(uint16(1), gasForDestinationLzReceive);

    return lzEndpoint.estimateFees(_dstChainId, address(this), payload, false, adapterParams);
  }

  /**
   * @dev Set the cross-chain router contract
   * @param _router Address of the CrossChainRouter contract
   */
  function setCrossChainRouter(address _router) external onlyRole(ROUTER_ADMIN_ROLE) {
    require(_router != address(0), "LookCoin: invalid router");
    crossChainRouter = ICrossChainRouter(_router);
  }

  /**
   * @dev Set Hyperlane mailbox for message passing
   * @param _mailbox Address of Hyperlane mailbox
   */
  function setHyperlaneMailbox(address _mailbox) external onlyRole(PROTOCOL_ADMIN_ROLE) {
    require(_mailbox != address(0), "LookCoin: invalid mailbox");
    hyperlaneMailbox = _mailbox;
  }

  /**
   * @dev Sets the Hyperlane gas paymaster address
   * @param _gasPaymaster The address of the Hyperlane gas paymaster
   */
  function setHyperlaneGasPaymaster(address _gasPaymaster) external onlyRole(PROTOCOL_ADMIN_ROLE) {
    require(_gasPaymaster != address(0), "LookCoin: invalid gas paymaster");
    hyperlaneGasPaymaster = IInterchainGasPaymaster(_gasPaymaster);
  }

  /**
   * @dev Sets whether a Hyperlane domain is supported
   * @param domain The Hyperlane domain ID
   * @param supported Whether the domain is supported
   */
  function setSupportedHyperlaneDomain(uint32 domain, bool supported) external onlyRole(PROTOCOL_ADMIN_ROLE) {
    supportedHyperlaneDomains[domain] = supported;
  }









  /**
   * @dev Handle incoming Hyperlane messages
   * @param _origin Origin domain ID
   * @param _sender Sender address on origin chain
   * @param _message Encoded message data
   */
  function handle(uint32 _origin, bytes32 _sender, bytes calldata _message) external payable override {
    require(msg.sender == hyperlaneMailbox, "LookCoin: unauthorized mailbox");

    // Decode the message
    (address recipient, uint256 amount) = abi.decode(_message, (address, uint256));

    // Mint tokens to recipient
    totalMinted += amount;
    _mint(recipient, amount);
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
   * @dev Override _update to add pause functionality
   */
  function _update(address from, address to, uint256 amount) internal override whenNotPaused {
    super._update(from, to, amount);
  }

  /**
   * @dev Authorize contract upgrade. Only callable by UPGRADER_ROLE
   * @param newImplementation Address of new implementation
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

  /**
   * @dev Override supportsInterface for multiple inheritance
   */
  function supportsInterface(bytes4 interfaceId) public view override(AccessControlUpgradeable) returns (bool) {
    return super.supportsInterface(interfaceId);
  }
}
