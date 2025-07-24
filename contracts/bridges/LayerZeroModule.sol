// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../interfaces/ILookCoin.sol";

// LayerZero V2 interfaces
interface ILayerZeroEndpointV2 {
    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }

    struct MessagingParams {
        uint32 dstEid;
        bytes32 receiver;
        bytes message;
        bytes options;
        bool payInLzToken;
    }

    function send(
        MessagingParams calldata _params,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory);

    function quote(
        MessagingParams calldata _params,
        address _sender
    ) external view returns (MessagingFee memory);

    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;
        MessagingFee fee;
    }
}

/**
 * @title LayerZeroModule
 * @dev LayerZero V2 bridge module for cross-chain transfers
 */
contract LayerZeroModule is
  AccessControlUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  UUPSUpgradeable,
  ILookBridgeModule
{
  bytes32 public constant BRIDGE_ADMIN_ROLE = keccak256("BRIDGE_ADMIN_ROLE");
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
  bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

  ILookCoin public lookCoin;
  ILayerZeroEndpointV2 public lzEndpoint;
  
  mapping(bytes32 => BridgeTransfer) public transfers;
  mapping(uint32 => uint256) public eidToChainId; // LayerZero endpoint ID to standard chain ID
  mapping(uint256 => uint32) public chainIdToEid; // Standard chain ID to LayerZero endpoint ID
  mapping(uint32 => bytes32) public trustedRemotes; // Trusted remote addresses per endpoint ID
  
  // Gas and options configuration
  mapping(uint32 => bytes) public defaultOptions; // Default LayerZero options per destination
  uint256 public defaultGasLimit = 200000;

  uint256[50] private __gap;

  event ChainMappingUpdated(uint32 eid, uint256 chainId);
  event TrustedRemoteUpdated(uint32 eid, bytes32 trustedRemote);
  event DefaultOptionsUpdated(uint32 eid, bytes options);

  function initialize(address _lookCoin, address _lzEndpoint, address _admin) public initializer {
    __AccessControl_init();
    __Pausable_init();
    __ReentrancyGuard_init();
    __UUPSUpgradeable_init();

    lookCoin = ILookCoin(_lookCoin);
    lzEndpoint = ILayerZeroEndpointV2(_lzEndpoint);

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(BRIDGE_ADMIN_ROLE, _admin);
    _grantRole(OPERATOR_ROLE, _admin);

    // Initialize common endpoint mappings (V2 endpoint IDs)
    eidToChainId[30101] = 1; // Ethereum
    chainIdToEid[1] = 30101;
    eidToChainId[30102] = 56; // BSC
    chainIdToEid[56] = 30102;
    eidToChainId[30111] = 10; // Optimism
    chainIdToEid[10] = 30111;
    eidToChainId[30109] = 137; // Polygon
    chainIdToEid[137] = 30109;
    eidToChainId[30184] = 8453; // Base
    chainIdToEid[8453] = 30184;
  }

  function bridgeOut(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
  ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
    require(amount > 0, "LayerZero: invalid amount");
    require(recipient != address(0), "LayerZero: invalid recipient");

    // Get LayerZero endpoint ID
    uint32 dstEid = chainIdToEid[destinationChain];
    require(dstEid != 0, "LayerZero: unsupported chain");
    require(trustedRemotes[dstEid] != bytes32(0), "LayerZero: no trusted remote");

    // Burn tokens from sender
    lookCoin.burn(msg.sender, amount);

    // Generate transfer ID
    transferId = keccak256(abi.encodePacked(msg.sender, recipient, amount, block.timestamp));

    // Store transfer info
    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: msg.sender,
      recipient: recipient,
      amount: amount,
      sourceChain: block.chainid,
      destinationChain: destinationChain,
      protocol: "LayerZero",
      status: TransferStatus.Pending,
      timestamp: block.timestamp
    });

    // Prepare message
    bytes memory message = abi.encode(recipient, amount, transferId);

    // Get options (use default if not provided)
    bytes memory options;
    if (params.length > 0) {
      options = params;
    } else if (defaultOptions[dstEid].length > 0) {
      options = defaultOptions[dstEid];
    } else {
      // Create default options with gas limit
      options = abi.encodePacked(uint16(3), defaultGasLimit);
    }

    // Send via LayerZero V2 endpoint
    ILayerZeroEndpointV2.MessagingParams memory msgParams = ILayerZeroEndpointV2.MessagingParams({
        dstEid: dstEid,
        receiver: trustedRemotes[dstEid],
        message: message,
        options: options,
        payInLzToken: false
    });

    lzEndpoint.send{value: msg.value}(msgParams, msg.sender);

    emit TransferInitiated(transferId, msg.sender, destinationChain, amount, "LayerZero");
  }

  function lzReceive(
    uint32 _srcEid,
    bytes32 _sender,
    uint64 _nonce,
    bytes calldata _message
  ) external {
    require(msg.sender == address(lzEndpoint), "LayerZero: unauthorized");
    require(trustedRemotes[_srcEid] == _sender, "LayerZero: untrusted sender");

    // Decode message
    (address recipient, uint256 amount, bytes32 originalTransferId) = abi.decode(_message, (address, uint256, bytes32));

    // Get standard chain ID
    uint256 sourceChain = eidToChainId[_srcEid];

    // Mint tokens to recipient
    lookCoin.mint(recipient, amount);

    // Create incoming transfer record
    bytes32 transferId = keccak256(abi.encodePacked(_srcEid, recipient, amount, block.timestamp));

    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: address(uint160(uint256(_sender))), // Extract address from bytes32
      recipient: recipient,
      amount: amount,
      sourceChain: sourceChain,
      destinationChain: block.chainid,
      protocol: "LayerZero",
      status: TransferStatus.Completed,
      timestamp: block.timestamp
    });

    emit TransferCompleted(transferId, recipient, amount);
  }

  function handleIncoming(
    uint256 sourceChain,
    address sender,
    address recipient,
    uint256 amount,
    bytes calldata data
  ) external override onlyRole(OPERATOR_ROLE) {
    // Manual handling if needed
    lookCoin.mint(recipient, amount);

    bytes32 transferId = keccak256(abi.encodePacked(sender, recipient, amount, block.timestamp));

    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: sender,
      recipient: recipient,
      amount: amount,
      sourceChain: sourceChain,
      destinationChain: block.chainid,
      protocol: "LayerZero",
      status: TransferStatus.Completed,
      timestamp: block.timestamp
    });

    emit TransferCompleted(transferId, recipient, amount);
  }

  function estimateFee(
    uint256 destinationChain,
    uint256 amount,
    bytes calldata params
  ) external view override returns (uint256 fee, uint256 estimatedTime) {
    uint32 dstEid = chainIdToEid[destinationChain];
    require(dstEid != 0, "LayerZero: unsupported chain");

    // Prepare message for fee estimation
    bytes memory message = abi.encode(msg.sender, amount, bytes32(0));
    
    // Get options
    bytes memory options;
    if (params.length > 0) {
      options = params;
    } else if (defaultOptions[dstEid].length > 0) {
      options = defaultOptions[dstEid];
    } else {
      options = abi.encodePacked(uint16(3), defaultGasLimit);
    }

    // Quote the message
    ILayerZeroEndpointV2.MessagingParams memory msgParams = ILayerZeroEndpointV2.MessagingParams({
        dstEid: dstEid,
        receiver: trustedRemotes[dstEid],
        message: message,
        options: options,
        payInLzToken: false
    });

    ILayerZeroEndpointV2.MessagingFee memory msgFee = lzEndpoint.quote(msgParams, msg.sender);
    fee = msgFee.nativeFee;

    // LayerZero V2 transfers typically take 2-5 minutes
    estimatedTime = 180;
  }

  function getStatus(bytes32 transferId) external view override returns (TransferStatus) {
    return transfers[transferId].status;
  }

  function updateChainMapping(uint32 eid, uint256 standardChainId) external onlyRole(BRIDGE_ADMIN_ROLE) {
    eidToChainId[eid] = standardChainId;
    chainIdToEid[standardChainId] = eid;
    emit ChainMappingUpdated(eid, standardChainId);
  }

  function setTrustedRemote(uint32 _eid, address _remote) external onlyRole(BRIDGE_ADMIN_ROLE) {
    trustedRemotes[_eid] = _addressToBytes32(_remote);
    emit TrustedRemoteUpdated(_eid, _addressToBytes32(_remote));
  }

  function setDefaultOptions(uint32 _eid, bytes calldata _options) external onlyRole(BRIDGE_ADMIN_ROLE) {
    defaultOptions[_eid] = _options;
    emit DefaultOptionsUpdated(_eid, _options);
  }

  function updateConfig(bytes calldata config) external override onlyRole(BRIDGE_ADMIN_ROLE) {
    // Decode and apply configuration updates
    (uint256 gasLimit, uint32 eid, bytes memory options) = abi.decode(config, (uint256, uint32, bytes));

    if (gasLimit > 0) {
      defaultGasLimit = gasLimit;
    }
    if (eid > 0 && options.length > 0) {
      defaultOptions[eid] = options;
    }
  }

  function emergencyWithdraw(address token, address to, uint256 amount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
    if (token == address(0)) {
      payable(to).transfer(amount);
    } else {
      IERC20(token).transfer(to, amount);
    }
  }

  function pause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
    _pause();
    emit ProtocolStatusChanged(ProtocolStatus.Paused);
  }

  function unpause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
    _unpause();
    emit ProtocolStatusChanged(ProtocolStatus.Active);
  }

  function _addressToBytes32(address addr) private pure returns (bytes32) {
    return bytes32(uint256(uint160(addr)));
  }

  function _bytes32ToAddress(bytes32 addr) private pure returns (address) {
    return address(uint160(uint256(addr)));
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

  receive() external payable {}
}
