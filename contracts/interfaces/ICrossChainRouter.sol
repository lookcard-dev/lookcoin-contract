// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ICrossChainRouter
 * @dev Unified interface for cross-chain token operations across multiple protocols
 */
interface ICrossChainRouter {
  enum Protocol {
    LayerZero,
    Celer,
    Hyperlane
  }

  enum TransferStatus {
    Pending,
    Completed,
    Failed,
    Refunded
  }

  enum RoutePreference {
    Cheapest,
    Fastest,
    MostSecure
  }

  struct BridgeOption {
    Protocol protocol;
    uint256 fee;
    uint256 estimatedTime;
    uint8 securityLevel;
    bool available;
    uint256 minAmount;
    uint256 maxAmount;
  }

  struct CrossChainTransfer {
    bytes32 id;
    address sender;
    address recipient;
    uint256 amount;
    uint256 sourceChain;
    uint256 destinationChain;
    Protocol protocol;
    TransferStatus status;
    uint256 timestamp;
    bytes32 messageHash;
    uint256 nonce;
  }

  /**
   * @dev Get available bridge options for a destination chain
   * @param chainId Destination chain ID
   * @param amount Amount to transfer
   * @return options Array of available bridge options
   */
  function getBridgeOptions(uint256 chainId, uint256 amount) external view returns (BridgeOption[] memory options);

  /**
   * @dev Get optimal route based on user preference
   * @param chainId Destination chain ID
   * @param amount Amount to transfer
   * @param preference 0: cheapest, 1: fastest, 2: most secure
   * @return protocol Recommended protocol
   */
  function getOptimalRoute(uint256 chainId, uint256 amount, RoutePreference preference) external view returns (Protocol protocol);

  /**
   * @dev Bridge tokens to another chain
   * @param chainId Destination chain ID
   * @param to Recipient address
   * @param amount Amount to transfer
   * @param protocol Preferred protocol (or auto-select if not specified)
   * @param data Additional protocol-specific data
   * @return transferId Unique transfer identifier
   */
  function bridgeToken(
    uint256 chainId,
    address to,
    uint256 amount,
    Protocol protocol,
    bytes calldata data
  ) external payable returns (bytes32 transferId);

  /**
   * @dev Get transfer status
   * @param transferId Transfer identifier
   * @return transfer Transfer details
   */
  function getTransfer(bytes32 transferId) external view returns (CrossChainTransfer memory transfer);

  /**
   * @dev Estimate total fee for cross-chain transfer
   * @param chainId Destination chain ID
   * @param amount Amount to transfer
   * @param protocol Protocol to use
   * @param data Protocol-specific data
   * @return fee Total fee in native token
   */
  function estimateFee(
    uint256 chainId,
    uint256 amount,
    Protocol protocol,
    bytes calldata data
  ) external view returns (uint256 fee);

  // Events
  event TransferInitiated(
    bytes32 indexed transferId,
    address indexed sender,
    uint256 indexed destinationChain,
    uint256 amount,
    Protocol protocol
  );

  event TransferCompleted(bytes32 indexed transferId, address indexed recipient, uint256 amount);

  event TransferFailed(bytes32 indexed transferId, string reason);

  event ProtocolConfigured(Protocol indexed protocol, address indexed moduleAddress, bool enabled);
}
