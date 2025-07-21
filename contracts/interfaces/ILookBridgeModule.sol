// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
        Deprecated
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

    event TransferInitiated(
        bytes32 indexed transferId,
        address indexed sender,
        uint256 destinationChain,
        uint256 amount,
        string protocol
    );

    event TransferCompleted(
        bytes32 indexed transferId,
        address indexed recipient,
        uint256 amount
    );

    event TransferFailed(
        bytes32 indexed transferId,
        string reason
    );

    event ProtocolStatusChanged(
        ProtocolStatus newStatus
    );

    function bridgeOut(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata params
    ) external payable returns (bytes32 transferId);

    function handleIncoming(
        uint256 sourceChain,
        address sender,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external;

    function estimateFee(
        uint256 destinationChain,
        uint256 amount,
        bytes calldata params
    ) external view returns (uint256 fee, uint256 estimatedTime);

    function getStatus(bytes32 transferId) external view returns (TransferStatus);

    function pause() external;
    function unpause() external;
    function updateConfig(bytes calldata config) external;
    function emergencyWithdraw(address token, address to, uint256 amount) external;
}