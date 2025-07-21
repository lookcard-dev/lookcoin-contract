// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../external/xERC20/interfaces/IXERC20.sol";

/**
 * @title XERC20Module
 * @dev SuperChain xERC20 module for Optimism ecosystem support
 */
contract XERC20Module is 
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    ILookBridgeModule 
{
    bytes32 public constant BRIDGE_ADMIN_ROLE = keccak256("BRIDGE_ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IXERC20 public lookCoin;
    mapping(bytes32 => BridgeTransfer) public transfers;
    mapping(uint256 => address) public chainBridges; // Chain ID to bridge address
    mapping(address => bool) public registeredBridges;
    
    // Rate limiting
    struct BridgeLimits {
        uint256 mintingLimit;
        uint256 burningLimit;
        uint256 lastResetTime;
        uint256 currentMinted;
        uint256 currentBurned;
    }
    
    mapping(address => BridgeLimits) public bridgeLimits;
    uint256 public constant LIMIT_RESET_PERIOD = 1 days;
    
    uint256[50] private __gap;

    event BridgeRegistered(address indexed bridge, uint256 indexed chainId);
    event BridgeLimitsUpdated(address indexed bridge, uint256 mintingLimit, uint256 burningLimit);
    event RateLimitExceeded(address indexed bridge, string limitType, uint256 amount);

    function initialize(
        address _lookCoin,
        address _admin
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        lookCoin = IXERC20(_lookCoin);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(BRIDGE_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    function bridgeOut(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata params
    ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
        require(amount > 0, "XERC20Module: invalid amount");
        require(recipient != address(0), "XERC20Module: invalid recipient");
        
        address bridge = chainBridges[destinationChain];
        require(bridge != address(0), "XERC20Module: bridge not configured");
        require(registeredBridges[bridge], "XERC20Module: bridge not registered");

        // Check burning limits
        _checkAndUpdateLimits(bridge, amount, false);

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
            protocol: "XERC20",
            status: TransferStatus.Pending,
            timestamp: block.timestamp
        });

        // Bridge-specific logic would go here
        // For OP Stack, this would interact with the bridge contract

        emit TransferInitiated(transferId, msg.sender, destinationChain, amount, "XERC20");
    }

    function handleIncoming(
        uint256 sourceChain,
        address sender,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external override whenNotPaused {
        require(registeredBridges[msg.sender], "XERC20Module: unauthorized bridge");
        
        // Check minting limits
        _checkAndUpdateLimits(msg.sender, amount, true);

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
            protocol: "XERC20",
            status: TransferStatus.Completed,
            timestamp: block.timestamp
        });

        emit TransferCompleted(transferId, recipient, amount);
    }

    function registerBridge(
        address bridge,
        uint256 chainId,
        uint256 mintingLimit,
        uint256 burningLimit
    ) external onlyRole(BRIDGE_ADMIN_ROLE) {
        require(bridge != address(0), "XERC20Module: invalid bridge");
        
        registeredBridges[bridge] = true;
        chainBridges[chainId] = bridge;
        
        // Set up limits
        bridgeLimits[bridge] = BridgeLimits({
            mintingLimit: mintingLimit,
            burningLimit: burningLimit,
            lastResetTime: block.timestamp,
            currentMinted: 0,
            currentBurned: 0
        });

        // Authorize bridge on LookCoin
        lookCoin.setLimits(bridge, mintingLimit, burningLimit);
        
        emit BridgeRegistered(bridge, chainId);
        emit BridgeLimitsUpdated(bridge, mintingLimit, burningLimit);
    }

    function updateBridgeLimits(
        address bridge,
        uint256 mintingLimit,
        uint256 burningLimit
    ) external onlyRole(BRIDGE_ADMIN_ROLE) {
        require(registeredBridges[bridge], "XERC20Module: bridge not registered");
        
        bridgeLimits[bridge].mintingLimit = mintingLimit;
        bridgeLimits[bridge].burningLimit = burningLimit;
        
        // Update limits on LookCoin
        lookCoin.setLimits(bridge, mintingLimit, burningLimit);
        
        emit BridgeLimitsUpdated(bridge, mintingLimit, burningLimit);
    }

    function _checkAndUpdateLimits(address bridge, uint256 amount, bool isMinting) private {
        BridgeLimits storage limits = bridgeLimits[bridge];
        
        // Reset limits if period has passed
        if (block.timestamp >= limits.lastResetTime + LIMIT_RESET_PERIOD) {
            limits.currentMinted = 0;
            limits.currentBurned = 0;
            limits.lastResetTime = block.timestamp;
        }
        
        if (isMinting) {
            require(limits.currentMinted + amount <= limits.mintingLimit, "XERC20Module: minting limit exceeded");
            limits.currentMinted += amount;
        } else {
            require(limits.currentBurned + amount <= limits.burningLimit, "XERC20Module: burning limit exceeded");
            limits.currentBurned += amount;
        }
    }

    function estimateFee(
        uint256 destinationChain,
        uint256 amount,
        bytes calldata params
    ) external view override returns (uint256 fee, uint256 estimatedTime) {
        // OP Stack bridges typically have fixed fees
        fee = 0.001 ether;
        
        // SuperChain transfers are fast (1-2 minutes)
        estimatedTime = 60;
    }

    function getStatus(bytes32 transferId) external view override returns (TransferStatus) {
        return transfers[transferId].status;
    }

    function updateConfig(bytes calldata config) external override onlyRole(BRIDGE_ADMIN_ROLE) {
        // Decode and apply configuration updates
        (address bridge, uint256 mintLimit, uint256 burnLimit) = abi.decode(
            config, 
            (address, uint256, uint256)
        );
        
        if (registeredBridges[bridge]) {
            updateBridgeLimits(bridge, mintLimit, burnLimit);
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