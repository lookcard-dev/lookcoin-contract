// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ILookBridgeModule
 * @dev Unified interface for all bridge protocol modules
 */
interface ILookBridgeModule {
  enum TransferStatus {
    Pending,
    Completed,
    Failed,
    Refunded
  }

  enum ProtocolStatus {
    Active,
    Paused,
    Disabled
  }

  struct BridgeTransfer {
    bytes32 id;
    address sender;
    address recipient;
    uint256 amount;
    uint256 sourceChain;
    uint256 destinationChain;
    string protocol;
    TransferStatus status;
    uint256 timestamp;
  }

  /**
   * @dev Bridge tokens to another chain
   * @param destinationChain Destination chain ID
   * @param recipient Recipient address on destination chain
   * @param amount Amount to bridge
   * @param params Protocol-specific parameters
   * @return transferId Unique transfer identifier
   */
  function bridgeToken(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
  ) external payable returns (bytes32 transferId);

  /**
   * @dev Handle incoming transfer from another chain
   * @param sourceChain Source chain ID
   * @param sender Sender address on source chain
   * @param recipient Recipient address on this chain
   * @param amount Amount to transfer
   * @param data Additional transfer data
   */
  function handleIncoming(
    uint256 sourceChain,
    address sender,
    address recipient,
    uint256 amount,
    bytes calldata data
  ) external;

  /**
   * @dev Estimate fee for cross-chain transfer
   * @param destinationChain Destination chain ID
   * @param amount Amount to transfer
   * @param params Protocol-specific parameters
   * @return fee Estimated fee in native token
   * @return estimatedTime Estimated transfer time in seconds
   */
  function estimateFee(
    uint256 destinationChain,
    uint256 amount,
    bytes calldata params
  ) external view returns (uint256 fee, uint256 estimatedTime);

  /**
   * @dev Get transfer status
   * @param transferId Transfer identifier
   * @return status Current transfer status
   */
  function getStatus(bytes32 transferId) external view returns (TransferStatus status);

  /**
   * @dev Update module configuration
   * @param config Encoded configuration data
   */
  function updateConfig(bytes calldata config) external;

  /**
   * @dev Emergency withdrawal function
   * @param token Token address (0 for native)
   * @param to Recipient address
   * @param amount Amount to withdraw
   */
  function emergencyWithdraw(address token, address to, uint256 amount) external;

  /**
   * @dev Pause the module
   */
  function pause() external;

  /**
   * @dev Unpause the module
   */
  function unpause() external;

  // Events
  event TransferInitiated(
    bytes32 indexed transferId,
    address indexed sender,
    uint256 indexed destinationChain,
    uint256 amount,
    string protocol
  );

  event TransferCompleted(bytes32 indexed transferId, address indexed recipient, uint256 amount);

  event TransferFailed(bytes32 indexed transferId, string reason);

  event ProtocolStatusChanged(ProtocolStatus status);

  event BridgeRegistered(address indexed bridge);
  event BridgeRemoved(address indexed bridge);
  event BridgeLimitsSet(address indexed bridge, uint256 mintingLimit, uint256 burningLimit);
}
