// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./ICrossChainRouter.sol";

/**
 * @title IRouterAdapter
 * @dev Adapter interface to make router compatible with test expectations
 * @notice Provides bridgeToken method that maps to bridge
 */
interface IRouterAdapter {
    /**
     * @dev Bridge tokens using legacy naming convention
     * @param protocol Protocol to use
     * @param destinationChain Destination chain ID
     * @param recipient Recipient address
     * @param amount Amount to transfer
     * @param data Additional data
     */
    function bridgeToken(
        ICrossChainRouter.Protocol protocol,
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external payable returns (bytes32);
}