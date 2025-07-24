// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ICrossChainRouter.sol";
import "./interfaces/ILookBridgeModule.sol";

/**
 * @title CrossChainRouter
 * @dev Unified router for cross-chain token transfers across multiple protocols
 */
contract CrossChainRouter is
  ICrossChainRouter,
  AccessControlUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  UUPSUpgradeable
{
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

  IERC20 public lookCoin;

  // Protocol modules
  mapping(Protocol => address) public protocolModules;
  mapping(Protocol => bool) public protocolEnabled;

  // Chain support per protocol
  mapping(Protocol => mapping(uint256 => bool)) public chainSupported;

  // Transfer tracking
  mapping(bytes32 => CrossChainTransfer) public transfers;
  uint256 public transferNonce;

  // Protocol preferences and configurations
  mapping(uint256 => Protocol[]) public chainProtocols; // Available protocols per chain
  mapping(Protocol => uint256) public protocolSecurityLevel; // 1-10 scale

  uint256[50] private __gap;

  modifier onlyValidProtocol(Protocol protocol) {
    require(protocolModules[protocol] != address(0), "Protocol not configured");
    require(protocolEnabled[protocol], "Protocol disabled");
    _;
  }

  modifier onlyValidChain(Protocol protocol, uint256 chainId) {
    require(chainSupported[protocol][chainId], "Chain not supported by protocol");
    _;
  }

  function initialize(address _lookCoin, address _admin) public initializer {
    __AccessControl_init();
    __Pausable_init();
    __ReentrancyGuard_init();
    __UUPSUpgradeable_init();

    lookCoin = IERC20(_lookCoin);

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(ADMIN_ROLE, _admin);
    _grantRole(OPERATOR_ROLE, _admin);

    // Set default security levels
    protocolSecurityLevel[Protocol.LayerZero] = 9;
    protocolSecurityLevel[Protocol.Celer] = 7;
    protocolSecurityLevel[Protocol.Hyperlane] = 8;
  }

  /**
   * @dev Configure a protocol module
   * @param protocol Protocol type
   * @param moduleAddress Module contract address
   * @param enabled Whether the protocol is enabled
   */
  function configureProtocol(Protocol protocol, address moduleAddress, bool enabled) external onlyRole(ADMIN_ROLE) {
    protocolModules[protocol] = moduleAddress;
    protocolEnabled[protocol] = enabled;

    emit ProtocolConfigured(protocol, moduleAddress, enabled);
  }

  /**
   * @dev Configure chain support for a protocol
   * @param protocol Protocol type
   * @param chainId Chain ID
   * @param supported Whether the chain is supported
   */
  function configureChainSupport(Protocol protocol, uint256 chainId, bool supported) external onlyRole(ADMIN_ROLE) {
    chainSupported[protocol][chainId] = supported;

    if (supported) {
      // Add to chain protocols if not already present
      Protocol[] storage protocols = chainProtocols[chainId];
      bool exists = false;
      for (uint i = 0; i < protocols.length; i++) {
        if (protocols[i] == protocol) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        protocols.push(protocol);
      }
    } else {
      // Remove from chain protocols
      Protocol[] storage protocols = chainProtocols[chainId];
      for (uint i = 0; i < protocols.length; i++) {
        if (protocols[i] == protocol) {
          protocols[i] = protocols[protocols.length - 1];
          protocols.pop();
          break;
        }
      }
    }
  }

  /**
   * @dev Get available bridge options for a destination chain
   */
  function getBridgeOptions(
    uint256 chainId,
    uint256 amount
  ) external view override returns (BridgeOption[] memory options) {
    Protocol[] memory availableProtocols = chainProtocols[chainId];
    options = new BridgeOption[](availableProtocols.length);

    uint256 validOptions = 0;
    for (uint i = 0; i < availableProtocols.length; i++) {
      Protocol protocol = availableProtocols[i];

      if (protocolEnabled[protocol] && chainSupported[protocol][chainId]) {
        address moduleAddress = protocolModules[protocol];
        if (moduleAddress != address(0)) {
          try ILookBridgeModule(moduleAddress).estimateFee(chainId, amount, "") returns (
            uint256 fee,
            uint256 estimatedTime
          ) {
            options[validOptions] = BridgeOption({
              protocol: protocol,
              fee: fee,
              estimatedTime: estimatedTime,
              securityLevel: uint8(protocolSecurityLevel[protocol]),
              available: true,
              minAmount: 0, // Can be configured per protocol
              maxAmount: type(uint256).max // Can be configured per protocol
            });
            validOptions++;
          } catch {
            // Protocol unavailable, skip
          }
        }
      }
    }

    // Resize array to actual valid options
    assembly {
      mstore(options, validOptions)
    }
  }

  /**
   * @dev Get optimal route based on user preference
   */
  function getOptimalRoute(
    uint256 chainId,
    uint256 amount,
    RoutePreference preference
  ) external view returns (Protocol protocol) {
    BridgeOption[] memory options = this.getBridgeOptions(chainId, amount);
    require(options.length > 0, "No available routes");

    if (preference == RoutePreference.Cheapest) {
      // Cheapest
      uint256 lowestFee = type(uint256).max;
      for (uint i = 0; i < options.length; i++) {
        if (options[i].available && options[i].fee < lowestFee) {
          lowestFee = options[i].fee;
          protocol = options[i].protocol;
        }
      }
    } else if (preference == RoutePreference.Fastest) {
      // Fastest
      uint256 shortestTime = type(uint256).max;
      for (uint i = 0; i < options.length; i++) {
        if (options[i].available && options[i].estimatedTime < shortestTime) {
          shortestTime = options[i].estimatedTime;
          protocol = options[i].protocol;
        }
      }
    } else if (preference == RoutePreference.MostSecure) {
      // Most secure
      uint8 highestSecurity = 0;
      for (uint i = 0; i < options.length; i++) {
        if (options[i].available && options[i].securityLevel > highestSecurity) {
          highestSecurity = options[i].securityLevel;
          protocol = options[i].protocol;
        }
      }
    } else {
      // Default to first available
      protocol = options[0].protocol;
    }
  }

  /**
   * @dev Bridge tokens to another chain
   */
  function bridgeToken(
    uint256 chainId,
    address to,
    uint256 amount,
    Protocol protocol,
    bytes calldata data
  )
    external
    payable
    override
    whenNotPaused
    nonReentrant
    onlyValidProtocol(protocol)
    onlyValidChain(protocol, chainId)
    returns (bytes32 transferId)
  {
    require(to != address(0), "Invalid recipient");
    require(amount > 0, "Invalid amount");

    // Generate unique transfer ID
    transferId = keccak256(
      abi.encodePacked(msg.sender, to, amount, chainId, protocol, block.timestamp, transferNonce++)
    );

    // Store transfer info
    transfers[transferId] = CrossChainTransfer({
      id: transferId,
      sender: msg.sender,
      recipient: to,
      amount: amount,
      sourceChain: block.chainid,
      destinationChain: chainId,
      protocol: protocol,
      status: TransferStatus.Pending,
      timestamp: block.timestamp,
      messageHash: bytes32(0),
      nonce: transferNonce
    });

    // Transfer tokens from sender to this contract
    lookCoin.transferFrom(msg.sender, address(this), amount);

    // Approve the protocol module to spend tokens
    address moduleAddress = protocolModules[protocol];
    lookCoin.approve(moduleAddress, amount);

    // Execute bridge through protocol module
    try ILookBridgeModule(moduleAddress).bridgeOut{value: msg.value}(chainId, to, amount, data) returns (
      bytes32 moduleTransferId
    ) {
      // Update transfer with module's transfer ID
      transfers[transferId].messageHash = moduleTransferId;

      emit TransferInitiated(transferId, msg.sender, chainId, amount, protocol);
    } catch Error(string memory reason) {
      // Refund tokens on failure
      lookCoin.transfer(msg.sender, amount);
      transfers[transferId].status = TransferStatus.Failed;

      emit TransferFailed(transferId, reason);
      revert(reason);
    }
  }

  /**
   * @dev Get transfer details
   */
  function getTransfer(bytes32 transferId) external view override returns (CrossChainTransfer memory) {
    return transfers[transferId];
  }

  /**
   * @dev Estimate fee for cross-chain transfer
   */
  function estimateFee(
    uint256 chainId,
    uint256 amount,
    Protocol protocol,
    bytes calldata data
  ) external view override onlyValidProtocol(protocol) onlyValidChain(protocol, chainId) returns (uint256 fee) {
    address moduleAddress = protocolModules[protocol];
    (fee, ) = ILookBridgeModule(moduleAddress).estimateFee(chainId, amount, data);
  }

  /**
   * @dev Update transfer status (called by protocol modules)
   */
  function updateTransferStatus(bytes32 transferId, TransferStatus status) external {
    // Verify caller is a valid protocol module
    bool isValidModule = false;
    for (uint i = 0; i < 3; i++) {
      if (protocolModules[Protocol(i)] == msg.sender) {
        isValidModule = true;
        break;
      }
    }
    require(isValidModule, "Unauthorized caller");

    transfers[transferId].status = status;

    if (status == TransferStatus.Completed) {
      emit TransferCompleted(transferId, transfers[transferId].recipient, transfers[transferId].amount);
    } else if (status == TransferStatus.Failed) {
      emit TransferFailed(transferId, "Transfer failed");
    }
  }

  /**
   * @dev Emergency pause
   */
  function pause() external onlyRole(ADMIN_ROLE) {
    _pause();
  }

  /**
   * @dev Unpause
   */
  function unpause() external onlyRole(ADMIN_ROLE) {
    _unpause();
  }

  /**
   * @dev Emergency withdrawal
   */
  function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) {
    if (token == address(0)) {
      payable(to).transfer(amount);
    } else {
      IERC20(token).transfer(to, amount);
    }
  }

  /**
   * @dev Authorize upgrade
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}

  /**
   * @dev Receive function to accept ETH
   */
  receive() external payable {}
}
