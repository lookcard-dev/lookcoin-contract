// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./ICrossChainRouter.sol";

/**
 * @title ITestRouter
 * @dev Extended router interface for testing
 * @notice Adds bridgeToken method for backward compatibility with tests
 */
interface ITestRouter is ICrossChainRouter {
    /**
     * @dev Bridge tokens using legacy method signature
     * @param protocol Protocol to use
     * @param destinationChain Destination chain ID
     * @param recipient Recipient address
     * @param amount Amount to transfer
     * @param data Additional data
     */
    function bridgeToken(
        Protocol protocol,
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external payable returns (bytes32);

    function pauseProtocol(Protocol protocol) external;
    function grantRole(bytes32 role, address account) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
    function DEFAULT_ADMIN_ROLE() external pure returns (bytes32);
    function paused() external view returns (bool);
}