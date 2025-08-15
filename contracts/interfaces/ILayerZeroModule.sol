// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ILayerZeroModule
 * @dev Interface for the LayerZero bridge module
 * @notice Handles LayerZero-specific bridge operations
 */
interface ILayerZeroModule {
    // Events
    event TokensBridged(uint16 destinationChain, address recipient, uint256 amount);
    event BridgeReceived(uint16 sourceChain, address recipient, uint256 amount);

    // Core functions
    function bridgeToken(
        uint16 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata adapterParams
    ) external payable;

    function estimateFee(
        uint16 destinationChain,
        uint256 amount,
        bytes calldata adapterParams
    ) external view returns (uint256 nativeFee, uint256 zroFee);

    function setTrustedRemote(uint16 chainId, bytes32 trustedRemote) external;
    function getTrustedRemote(uint16 chainId) external view returns (bytes32);
    function pause() external;
    function unpause() external;

    // LayerZero receiver interface
    function lzReceive(
        uint16 srcChainId,
        bytes calldata srcAddress,
        uint64 nonce,
        bytes calldata payload
    ) external;
}