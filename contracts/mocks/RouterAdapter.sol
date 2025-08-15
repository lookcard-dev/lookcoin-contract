// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../interfaces/ICrossChainRouter.sol";
import "../interfaces/IRouterAdapter.sol";

/**
 * @title RouterAdapter
 * @dev Adapter contract to provide backward compatibility for tests
 * @notice Maps bridgeToken calls to bridge method
 */
contract RouterAdapter is IRouterAdapter {
    ICrossChainRouter public immutable router;

    constructor(address _router) {
        router = ICrossChainRouter(_router);
    }

    /**
     * @dev Bridge tokens using legacy naming convention
     */
    function bridgeToken(
        ICrossChainRouter.Protocol protocol,
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external payable override returns (bytes32) {
        // Forward to router's bridge method
        return router.bridge{value: msg.value}(
            destinationChain,
            recipient,
            amount,
            protocol,
            data
        );
    }

    // Forward other router methods
    function getBridgeOptions(uint256 chainId, uint256 amount) 
        external view returns (ICrossChainRouter.BridgeOption[] memory) {
        return router.getBridgeOptions(chainId, amount);
    }

    function getOptimalRoute(
        uint256 chainId, 
        uint256 amount, 
        ICrossChainRouter.RoutePreference preference
    ) external view returns (ICrossChainRouter.Protocol) {
        return router.getOptimalRoute(chainId, amount, preference);
    }

    function pauseProtocol(ICrossChainRouter.Protocol protocol) external {
        // This would need access control in production
        // For testing, we'll make it callable by anyone
        (bool success,) = address(router).call(
            abi.encodeWithSignature("pauseProtocol(uint8)", uint8(protocol))
        );
        require(success, "Failed to pause protocol");
    }

    function grantRole(bytes32 role, address account) external {
        // Forward role management for testing
        (bool success,) = address(router).call(
            abi.encodeWithSignature("grantRole(bytes32,address)", role, account)
        );
        require(success, "Failed to grant role");
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        (bool success, bytes memory data) = address(router).staticcall(
            abi.encodeWithSignature("hasRole(bytes32,address)", role, account)
        );
        require(success, "Failed to check role");
        return abi.decode(data, (bool));
    }

    function DEFAULT_ADMIN_ROLE() external pure returns (bytes32) {
        return 0x00;
    }

    function paused() external view returns (bool) {
        (bool success, bytes memory data) = address(router).staticcall(
            abi.encodeWithSignature("paused()")
        );
        require(success, "Failed to check paused state");
        return abi.decode(data, (bool));
    }
}