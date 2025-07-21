// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@layerzerolabs/oft-evm/contracts/oft/v2/OFTCoreV2Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../LookCoin.sol";

/**
 * @title LayerZeroModule
 * @dev Dedicated LayerZero OFT V2 module implementing unified bridge interface
 */
contract LayerZeroModule is 
    OFTCoreV2Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    ILookBridgeModule 
{
    bytes32 public constant BRIDGE_ADMIN_ROLE = keccak256("BRIDGE_ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    LookCoin public lookCoin;
    mapping(bytes32 => BridgeTransfer) public transfers;
    mapping(uint16 => uint256) public chainIdMapping; // LayerZero chainId to standard chainId
    
    uint256[50] private __gap;

    event ChainMappingUpdated(uint16 lzChainId, uint256 standardChainId);

    function initialize(
        address _lookCoin,
        address _lzEndpoint,
        address _admin
    ) public initializer {
        __OFTCoreV2_init(_lzEndpoint);
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        lookCoin = LookCoin(_lookCoin);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(BRIDGE_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        // Initialize common chain mappings
        chainIdMapping[101] = 1; // Ethereum
        chainIdMapping[102] = 56; // BSC
        chainIdMapping[109] = 10; // Optimism
        chainIdMapping[110] = 137; // Polygon
        chainIdMapping[184] = 8453; // Base
    }

    function bridgeOut(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata params
    ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
        require(amount > 0, "LayerZeroModule: invalid amount");
        require(recipient != address(0), "LayerZeroModule: invalid recipient");
        
        // Find LayerZero chain ID
        uint16 lzChainId = _findLzChainId(destinationChain);
        require(lzChainId != 0, "LayerZeroModule: unsupported chain");

        // Burn tokens from sender
        lookCoin.burn(msg.sender, amount);

        // Generate transfer ID
        transferId = keccak256(abi.encodePacked(msg.sender, recipient, amount, block.timestamp));

        // Store transfer info
        transfers[transferId] = BridgeTransfer({
            id: transferId,
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            sourceChain: block.chainid,
            destinationChain: destinationChain,
            protocol: "LayerZero",
            status: TransferStatus.Pending,
            timestamp: block.timestamp
        });

        // Prepare OFT payload
        bytes memory toAddress = abi.encodePacked(recipient);
        bytes memory payload = abi.encode(PT_SEND, toAddress, amount);
        
        // Send via LayerZero
        _lzSend(
            lzChainId,
            payload,
            payable(msg.sender),
            address(0),
            params,
            msg.value
        );

        emit TransferInitiated(transferId, msg.sender, destinationChain, amount, "LayerZero");
    }

    function handleIncoming(
        uint256 sourceChain,
        address sender,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external override onlyRole(OPERATOR_ROLE) {
        // This function is called by the OFT receiver logic
        // Mint tokens to recipient
        lookCoin.mint(recipient, amount);
        
        bytes32 transferId = keccak256(abi.encodePacked(sender, recipient, amount, block.timestamp));
        
        transfers[transferId] = BridgeTransfer({
            id: transferId,
            sender: sender,
            recipient: recipient,
            amount: amount,
            sourceChain: sourceChain,
            destinationChain: block.chainid,
            protocol: "LayerZero",
            status: TransferStatus.Completed,
            timestamp: block.timestamp
        });

        emit TransferCompleted(transferId, recipient, amount);
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal override {
        // Decode OFT payload
        (uint16 packetType, bytes memory toAddressBytes, uint256 amount) = abi.decode(
            _payload,
            (uint16, bytes, uint256)
        );

        require(packetType == PT_SEND, "LayerZeroModule: invalid packet type");

        address toAddress;
        assembly {
            toAddress := mload(add(toAddressBytes, 20))
        }

        // Get standard chain ID
        uint256 sourceChain = chainIdMapping[_srcChainId];
        
        // Handle incoming transfer
        this.handleIncoming(sourceChain, address(0), toAddress, amount, "");
    }

    function estimateFee(
        uint256 destinationChain,
        uint256 amount,
        bytes calldata params
    ) external view override returns (uint256 fee, uint256 estimatedTime) {
        uint16 lzChainId = _findLzChainId(destinationChain);
        require(lzChainId != 0, "LayerZeroModule: unsupported chain");

        bytes memory toAddress = abi.encodePacked(msg.sender);
        bytes memory payload = abi.encode(PT_SEND, toAddress, amount);

        (fee,) = lzEndpoint.estimateFees(
            lzChainId,
            address(this),
            payload,
            false,
            params
        );

        // Estimate 2-5 minutes for LayerZero transfers
        estimatedTime = 120;
    }

    function getStatus(bytes32 transferId) external view override returns (TransferStatus) {
        return transfers[transferId].status;
    }

    function updateChainMapping(uint16 lzChainId, uint256 standardChainId) external onlyRole(BRIDGE_ADMIN_ROLE) {
        chainIdMapping[lzChainId] = standardChainId;
        emit ChainMappingUpdated(lzChainId, standardChainId);
    }

    function _findLzChainId(uint256 standardChainId) private view returns (uint16) {
        for (uint16 i = 1; i < 300; i++) {
            if (chainIdMapping[i] == standardChainId) {
                return i;
            }
        }
        return 0;
    }

    function updateConfig(bytes calldata config) external override onlyRole(BRIDGE_ADMIN_ROLE) {
        // Decode and apply configuration updates
        (uint256 gasLimit, address dvnAddress) = abi.decode(config, (uint256, address));
        
        if (gasLimit > 0) {
            minDstGasLookup[101][PT_SEND] = gasLimit;
        }
    }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20Upgradeable(token).transfer(to, amount);
        }
    }

    function pause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
        _pause();
        emit ProtocolStatusChanged(ProtocolStatus.Paused);
    }

    function unpause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
        _unpause();
        emit ProtocolStatusChanged(ProtocolStatus.Active);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}