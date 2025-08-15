// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ICelerIMModule
 * @dev Interface for the Celer Inter-chain Message bridge module
 * @notice Handles Celer-specific bridge operations
 */
interface ICelerIMModule {
    // Events
    event TokensBridged(uint16 destinationChain, address recipient, uint256 amount);
    event BridgeReceived(uint64 srcChainId, address recipient, uint256 amount);
    event MessageReceived(uint64 srcChainId, bytes message);

    // Core functions
    function bridgeToken(
        uint16 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata message
    ) external payable;

    function estimateFee(
        uint16 destinationChain,
        uint256 amount,
        bytes calldata message
    ) external view returns (uint256 fee, uint256 estimatedTime);

    function executeMessage(
        address sender,
        uint64 srcChainId,
        bytes calldata message,
        address executor
    ) external returns (uint256);

    function setRemoteContract(uint64 chainId, address remoteContract) external;
    function getRemoteContract(uint64 chainId) external view returns (address);
    function pause() external;
    function unpause() external;

    // Celer message receiver interface
    function executeMessageWithTransfer(
        address sender,
        address token,
        uint256 amount,
        uint64 srcChainId,
        bytes calldata message,
        address executor
    ) external returns (uint256);
}