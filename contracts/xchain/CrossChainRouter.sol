// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
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

    function initialize(
        address _lookCoin,
        address _feeManager,
        address _securityManager,
        address _admin
    ) public initializer {
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
        for (uint8 i = 0; i < 4; i++) {
            Protocol protocol = Protocol(i);
            if (protocolActive[protocol] && chainProtocolSupport[destinationChain][protocol]) {
                count++;
            }
        }

        options = new BridgeOption[](count);
        uint8 index = 0;

        for (uint8 i = 0; i < 4; i++) {
            Protocol protocol = Protocol(i);
            if (protocolActive[protocol] && chainProtocolSupport[destinationChain][protocol]) {
                address module = protocolModules[protocol];
                if (module != address(0)) {
                    try ILookBridgeModule(module).estimateFee(destinationChain, amount, "") 
                    returns (uint256 fee, uint256 estimatedTime) {
                        options[index] = BridgeOption({
                            protocol: protocol,
                            fee: fee,
                            estimatedTime: estimatedTime,
                            securityLevel: _getSecurityLevel(protocol),
                            available: true
                        });
                        index++;
                    } catch {
                        options[index] = BridgeOption({
                            protocol: protocol,
                            fee: 0,
                            estimatedTime: 0,
                            securityLevel: _getSecurityLevel(protocol),
                            available: false
                        });
                        index++;
                    }
                }
            }
        }
    }

    function getOptimalRoute(
        uint256 destinationChain,
        uint256 amount,
        RoutePreference preference
    ) external view returns (Protocol protocol, uint256 fee) {
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
        return (options[bestIndex].protocol, options[bestIndex].fee);
    }

    function bridgeToken(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        Protocol protocol,
        bytes calldata params
    ) external payable whenNotPaused nonReentrant returns (bytes32 transferId) {
        require(protocolActive[protocol], "Protocol not active");
        require(chainProtocolSupport[destinationChain][protocol], "Protocol not supported for chain");
        
        address module = protocolModules[protocol];
        require(module != address(0), "Protocol module not registered");

        transferId = ILookBridgeModule(module).bridgeOut{value: msg.value}(
            destinationChain,
            recipient,
            amount,
            params
        );

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

    function _getSecurityLevel(Protocol protocol) private pure returns (uint8) {
        if (protocol == Protocol.LayerZero) return 9;
        if (protocol == Protocol.Hyperlane) return 8;
        if (protocol == Protocol.Celer) return 7;
        if (protocol == Protocol.XERC20) return 7;
        return 5;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}