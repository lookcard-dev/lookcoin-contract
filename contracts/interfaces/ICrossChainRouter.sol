// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./ILookBridgeModule.sol";

interface ICrossChainRouter {
    enum Protocol {
        LayerZero,
        Celer,
        XERC20,
        Hyperlane
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
    }

    event RouteSelected(
        bytes32 indexed transferId,
        Protocol protocol,
        uint256 destinationChain,
        uint256 amount
    );

    event ProtocolRegistered(
        Protocol indexed protocol,
        address moduleAddress
    );

    event TransferRouted(
        bytes32 indexed transferId,
        address indexed sender,
        Protocol protocol,
        uint256 destinationChain
    );

    function getBridgeOptions(
        uint256 destinationChain,
        uint256 amount
    ) external view returns (BridgeOption[] memory options);

    function getOptimalRoute(
        uint256 destinationChain,
        uint256 amount,
        RoutePreference preference
    ) external view returns (Protocol protocol, uint256 fee);

    function bridgeToken(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        Protocol protocol,
        bytes calldata params
    ) external payable returns (bytes32 transferId);

    function getTransferStatus(
        bytes32 transferId
    ) external view returns (ILookBridgeModule.TransferStatus);

    function registerProtocol(
        Protocol protocol,
        address moduleAddress
    ) external;

    function updateProtocolStatus(
        Protocol protocol,
        bool active
    ) external;

    function setDefaultRoute(
        uint256 destinationChain,
        Protocol protocol
    ) external;
}