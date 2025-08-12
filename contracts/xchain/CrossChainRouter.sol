// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/ICrossChainRouter.sol";
import "../interfaces/ILookBridgeModule.sol";

contract CrossChainRouter is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable, 
    ICrossChainRouter 
{
    bytes32 public constant PROTOCOL_ADMIN_ROLE = keccak256("PROTOCOL_ADMIN_ROLE");
    bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");

    mapping(Protocol => address) public protocolModules;
    mapping(Protocol => bool) public protocolActive;
    mapping(uint256 => mapping(Protocol => bool)) public chainProtocolSupport;
    mapping(uint256 => Protocol) public defaultRoutes;
    mapping(bytes32 => Protocol) public transferProtocol;

    address public feeManager;
    address public securityManager;
    address public lookCoin;

    uint256[50] private __gap;

    event FeeManagerUpdated(address indexed newFeeManager);
    event SecurityManagerUpdated(address indexed newSecurityManager);
    event ChainProtocolSupportUpdated(uint256 indexed chainId, Protocol protocol, bool supported);
    event DefaultRouteUpdated(uint256 indexed chainId, Protocol protocol);
    event ProtocolRegistered(Protocol indexed protocol, address indexed moduleAddress);
    event TransferRouted(bytes32 indexed transferId, address indexed sender, Protocol protocol, uint256 destinationChain);
    event RouteSelected(bytes32 indexed transferId, Protocol protocol, uint256 destinationChain, uint256 amount);

    function initialize(
        address _lookCoin,
        address _feeManager,
        address _securityManager,
        address _admin
    ) public initializer {
        require(_lookCoin != address(0), "Router: invalid lookCoin");
        require(_feeManager != address(0), "Router: invalid feeManager");
        require(_securityManager != address(0), "Router: invalid securityManager");
        require(_admin != address(0), "Router: invalid admin");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PROTOCOL_ADMIN_ROLE, _admin);
        _grantRole(ROUTER_ADMIN_ROLE, _admin);

        lookCoin = _lookCoin;
        feeManager = _feeManager;
        securityManager = _securityManager;
    }

    function getBridgeOptions(
        uint256 destinationChain,
        uint256 amount
    ) external view returns (BridgeOption[] memory options) {
        uint8 count = 0;
        for (uint8 i = 0; i < 3; i++) {
            Protocol protocol = Protocol(i);
            // Include all protocols that have modules registered, regardless of active status
            if (protocolModules[protocol] != address(0) && chainProtocolSupport[destinationChain][protocol]) {
                count++;
            }
        }

        options = new BridgeOption[](count);
        uint8 index = 0;

        for (uint8 i = 0; i < 3; i++) {
            Protocol protocol = Protocol(i);
            if (protocolModules[protocol] != address(0) && chainProtocolSupport[destinationChain][protocol]) {
                address module = protocolModules[protocol];
                
                // Check if protocol is active and available
                if (protocolActive[protocol]) {
                    try ILookBridgeModule(module).estimateFee(destinationChain, amount, "") 
                    returns (uint256 fee, uint256 estimatedTime) {
                        options[index] = BridgeOption({
                            protocol: protocol,
                            fee: fee,
                            estimatedTime: estimatedTime,
                            securityLevel: _getSecurityLevel(protocol),
                            available: true,
                            minAmount: 0,
                            maxAmount: type(uint256).max
                        });
                        index++;
                    } catch {
                        options[index] = BridgeOption({
                            protocol: protocol,
                            fee: 0,
                            estimatedTime: 0,
                            securityLevel: _getSecurityLevel(protocol),
                            available: false,
                            minAmount: 0,
                            maxAmount: 0
                        });
                        index++;
                    }
                } else {
                    // Protocol is disabled, include it but mark as unavailable
                    options[index] = BridgeOption({
                        protocol: protocol,
                        fee: 0,
                        estimatedTime: 0,
                        securityLevel: _getSecurityLevel(protocol),
                        available: false,
                        minAmount: 0,
                        maxAmount: 0
                    });
                    index++;
                }
            }
        }
    }

    function getOptimalRoute(
        uint256 destinationChain,
        uint256 amount,
        RoutePreference preference
    ) external view returns (Protocol protocol) {
        BridgeOption[] memory options = this.getBridgeOptions(destinationChain, amount);
        require(options.length > 0, "No available routes");

        uint256 bestIndex = 0;
        
        if (preference == RoutePreference.Cheapest) {
            uint256 lowestFee = type(uint256).max;
            for (uint256 i = 0; i < options.length; i++) {
                if (options[i].available && options[i].fee < lowestFee) {
                    lowestFee = options[i].fee;
                    bestIndex = i;
                }
            }
        } else if (preference == RoutePreference.Fastest) {
            uint256 fastestTime = type(uint256).max;
            for (uint256 i = 0; i < options.length; i++) {
                if (options[i].available && options[i].estimatedTime < fastestTime) {
                    fastestTime = options[i].estimatedTime;
                    bestIndex = i;
                }
            }
        } else if (preference == RoutePreference.MostSecure) {
            uint8 highestSecurity = 0;
            for (uint256 i = 0; i < options.length; i++) {
                if (options[i].available && options[i].securityLevel > highestSecurity) {
                    highestSecurity = options[i].securityLevel;
                    bestIndex = i;
                }
            }
        }

        require(options[bestIndex].available, "No available route found");
        return options[bestIndex].protocol;
    }

    function bridge(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        Protocol protocol,
        bytes calldata params
    ) external payable whenNotPaused nonReentrant returns (bytes32 transferId) {
        require(protocolActive[protocol], "Protocol not active");
        require(chainProtocolSupport[destinationChain][protocol], "Protocol not supported for chain");
        require(recipient != address(0), "Router: invalid recipient");
        require(amount > 0, "Router: invalid amount");
        
        // Validate token approval
        IERC20 token = IERC20(lookCoin);
        require(token.allowance(msg.sender, address(this)) >= amount, 
            "Router: insufficient allowance");
        
        // Transfer tokens to router first
        require(token.transferFrom(msg.sender, address(this), amount), 
            "Router: transfer failed");
        
        address module = protocolModules[protocol];
        require(module != address(0), "Protocol module not registered");

        // Approve module to burn tokens
        token.approve(module, amount);

        transferId = ILookBridgeModule(module).bridge{value: msg.value}(
            destinationChain,
            recipient,
            amount,
            params
        );

        // Verify tokens were burned
        require(token.allowance(address(this), module) == 0, 
            "Module did not burn tokens");

        transferProtocol[transferId] = protocol;

        emit RouteSelected(transferId, protocol, destinationChain, amount);
        emit TransferRouted(transferId, msg.sender, protocol, destinationChain);
    }

    function getTransferStatus(
        bytes32 transferId
    ) external view returns (ILookBridgeModule.TransferStatus) {
        Protocol protocol = transferProtocol[transferId];
        address module = protocolModules[protocol];
        
        if (module == address(0)) {
            return ILookBridgeModule.TransferStatus.Failed;
        }

        return ILookBridgeModule(module).getStatus(transferId);
    }

    function registerProtocol(
        Protocol protocol,
        address moduleAddress
    ) external onlyRole(PROTOCOL_ADMIN_ROLE) {
        require(moduleAddress != address(0), "Invalid module address");
        protocolModules[protocol] = moduleAddress;
        protocolActive[protocol] = true;
        emit ProtocolRegistered(protocol, moduleAddress);
    }

    function updateProtocolStatus(
        Protocol protocol,
        bool active
    ) external onlyRole(PROTOCOL_ADMIN_ROLE) {
        protocolActive[protocol] = active;
    }

    function setChainProtocolSupport(
        uint256 chainId,
        Protocol protocol,
        bool supported
    ) external onlyRole(PROTOCOL_ADMIN_ROLE) {
        chainProtocolSupport[chainId][protocol] = supported;
        emit ChainProtocolSupportUpdated(chainId, protocol, supported);
    }

    function setDefaultRoute(
        uint256 destinationChain,
        Protocol protocol
    ) external onlyRole(ROUTER_ADMIN_ROLE) {
        require(chainProtocolSupport[destinationChain][protocol], "Protocol not supported for chain");
        defaultRoutes[destinationChain] = protocol;
        emit DefaultRouteUpdated(destinationChain, protocol);
    }

    function updateFeeManager(address _feeManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeManager != address(0), "Invalid fee manager");
        feeManager = _feeManager;
        emit FeeManagerUpdated(_feeManager);
    }

    function updateSecurityManager(address _securityManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_securityManager != address(0), "Invalid security manager");
        securityManager = _securityManager;
        emit SecurityManagerUpdated(_securityManager);
    }

    function pause() external onlyRole(ROUTER_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ROUTER_ADMIN_ROLE) {
        _unpause();
    }
    
    function getTransfer(bytes32 transferId) external view returns (CrossChainTransfer memory transfer) {
        Protocol protocol = transferProtocol[transferId];
        address module = protocolModules[protocol];
        require(module != address(0), "Transfer not found");
        
        // Get status from the module
        ILookBridgeModule.TransferStatus moduleStatus = ILookBridgeModule(module).getStatus(transferId);
        
        // Create transfer struct with available information
        transfer = CrossChainTransfer({
            id: transferId,
            sender: address(0), // Not available from interface
            recipient: address(0), // Not available from interface
            amount: 0, // Not available from interface
            sourceChain: block.chainid,
            destinationChain: 0, // Not available from interface
            protocol: protocol,
            status: TransferStatus(uint8(moduleStatus)),
            timestamp: block.timestamp,
            messageHash: bytes32(0),
            nonce: 0 // Not available from interface
        });
    }

    /**
     * @dev Estimate total fee for cross-chain transfer
     * @param chainId Destination chain ID
     * @param amount Amount to transfer
     * @param protocol Protocol to use
     * @param data Protocol-specific data
     * @return fee Total fee in native token
     */
    function estimateFee(
        uint256 chainId,
        uint256 amount,
        Protocol protocol,
        bytes calldata data
    ) external view returns (uint256 fee) {
        require(protocolActive[protocol], "Protocol not active");
        require(chainProtocolSupport[chainId][protocol], "Protocol not supported for chain");
        
        address module = protocolModules[protocol];
        require(module != address(0), "Protocol module not registered");
        
        (fee, ) = ILookBridgeModule(module).estimateFee(chainId, amount, data);
    }

    /**
     * @dev Check if a chain is configured for a specific protocol
     * @param chainId Chain ID to check
     * @param protocol Protocol to check
     * @return true if chain is configured and protocol is active
     */
    function isChainConfigured(uint256 chainId, Protocol protocol) external view returns (bool) {
        return chainProtocolSupport[chainId][protocol] && protocolActive[protocol];
    }

    /**
     * @dev Get available bridge options for a destination chain (overload)
     * @param chainId Destination chain ID
     * @return options Array of available bridge options
     */
    function getBridgeOptions(uint256 chainId) external view returns (BridgeOption[] memory options) {
        return this.getBridgeOptions(chainId, 0);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev Get security level for a protocol
     * @param protocol The protocol to check
     * @return Security level (1-3, where 3 is most secure)
     */
    function _getSecurityLevel(Protocol protocol) internal pure returns (uint8) {
        if (protocol == Protocol.LayerZero) {
            return 3; // Highest security with proven track record
        } else if (protocol == Protocol.Celer) {
            return 2; // Good security with SGN network
        } else if (protocol == Protocol.Hyperlane) {
            return 2; // Good security with validator set
        }
        return 1; // Default security level
    }

    /**
     * @dev Accept ETH refunds from bridge modules
     * @notice Bridge modules may refund excess ETH sent for cross-chain fees
     */
    receive() external payable {
        // Accept ETH refunds from bridge operations
        // ETH can later be withdrawn by admin if needed
    }
}