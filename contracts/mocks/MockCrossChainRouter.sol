// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../interfaces/ITestRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockCrossChainRouter
 * @dev Mock router for testing with bridgeToken compatibility
 * @notice Provides both bridge and bridgeToken methods for testing
 */
contract MockCrossChainRouter is AccessControl, Pausable, ReentrancyGuard {
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

    bytes32 public constant PROTOCOL_ADMIN_ROLE = keccak256("PROTOCOL_ADMIN_ROLE");
    bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");

    mapping(Protocol => bool) public protocolActive;
    mapping(uint256 => mapping(Protocol => bool)) public chainProtocolSupport;
    mapping(bytes32 => CrossChainTransfer) private transfers;
    
    address public lookCoin;
    uint256 private transferNonce;

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
    event BridgeTokenCalled(Protocol protocol, uint256 chain, address recipient, uint256 amount);

    constructor(address _lookCoin, address _admin) {
        lookCoin = _lookCoin;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PROTOCOL_ADMIN_ROLE, _admin);
        _grantRole(ROUTER_ADMIN_ROLE, _admin);
        
        // Enable all protocols by default for testing
        protocolActive[Protocol.LayerZero] = true;
        protocolActive[Protocol.Celer] = true;
        protocolActive[Protocol.Hyperlane] = true;
        
        // Support all chains for testing
        for (uint8 p = 0; p < 3; p++) {
            chainProtocolSupport[56][Protocol(p)] = true; // BSC
            chainProtocolSupport[8453][Protocol(p)] = true; // Base
            chainProtocolSupport[10][Protocol(p)] = true; // Optimism
        }
    }

    /**
     * @dev Bridge tokens using method name expected by attack contracts
     */
    function bridgeToken(
        Protocol protocol,
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external payable whenNotPaused nonReentrant returns (bytes32) {
        emit BridgeTokenCalled(protocol, destinationChain, recipient, amount);
        
        // Check protocol is active
        require(protocolActive[protocol], "Protocol not active");
        require(chainProtocolSupport[destinationChain][protocol], "Protocol not supported for chain");
        
        // Transfer tokens from sender
        IERC20(lookCoin).transferFrom(msg.sender, address(this), amount);
        
        // Create transfer record
        bytes32 transferId = keccak256(abi.encodePacked(msg.sender, transferNonce++, block.timestamp));
        
        transfers[transferId] = CrossChainTransfer({
            id: transferId,
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            sourceChain: block.chainid,
            destinationChain: destinationChain,
            protocol: protocol,
            status: TransferStatus.Pending,
            timestamp: block.timestamp,
            messageHash: keccak256(data),
            nonce: transferNonce
        });
        
        emit TransferInitiated(transferId, msg.sender, destinationChain, amount, protocol);
        
        return transferId;
    }

    /**
     * @dev Standard bridge method
     */
    function bridge(
        uint256 chainId,
        address to,
        uint256 amount,
        Protocol protocol,
        bytes calldata data
    ) external payable returns (bytes32) {
        return this.bridgeToken(protocol, chainId, to, amount, data);
    }

    function getBridgeOptions(
        uint256 chainId,
        uint256 amount
    ) external view returns (BridgeOption[] memory options) {
        options = new BridgeOption[](3);
        
        for (uint8 i = 0; i < 3; i++) {
            Protocol p = Protocol(i);
            options[i] = BridgeOption({
                protocol: p,
                fee: 0.01 ether,
                estimatedTime: 300,
                securityLevel: 8,
                available: protocolActive[p] && chainProtocolSupport[chainId][p],
                minAmount: 1e18,
                maxAmount: 1000000e18
            });
        }
    }

    function getOptimalRoute(
        uint256 chainId,
        uint256 amount,
        RoutePreference preference
    ) external view returns (Protocol) {
        // For testing, always return LayerZero
        return Protocol.LayerZero;
    }

    function getTransfer(bytes32 transferId) external view returns (CrossChainTransfer memory) {
        return transfers[transferId];
    }

    function estimateFee(
        uint256 chainId,
        uint256 amount,
        Protocol protocol,
        bytes calldata data
    ) external pure returns (uint256) {
        return 0.01 ether;
    }

    function pauseProtocol(Protocol protocol) external {
        protocolActive[protocol] = false;
    }

    function unpauseProtocol(Protocol protocol) external {
        protocolActive[protocol] = true;
    }

    function pauseAll() external onlyRole(PROTOCOL_ADMIN_ROLE) {
        _pause();
    }

    function unpauseAll() external onlyRole(PROTOCOL_ADMIN_ROLE) {
        _unpause();
    }

    // Additional mock functions for testing
    function isReentrant() external view returns (bool) {
        // This will return true if we're in a reentrant call
        // Used for testing reentrancy protection
        return false;
    }

    receive() external payable {}
}