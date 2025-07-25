// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/ICrossChainRouter.sol";

contract ProtocolRegistry is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    
    struct ProtocolInfo {
        address moduleAddress;
        string version;
        bool active;
        bool deprecated;
        uint256 registeredAt;
        uint256 lastHealthCheck;
    }

    struct ChainSupport {
        bool supported;
        uint256 addedAt;
        bytes config;
    }

    mapping(ICrossChainRouter.Protocol => ProtocolInfo) public protocols;
    mapping(ICrossChainRouter.Protocol => mapping(uint256 => ChainSupport)) public chainSupport;
    mapping(ICrossChainRouter.Protocol => bytes) public protocolConfigs;
    
    uint256 public constant HEALTH_CHECK_INTERVAL = 1 hours;

    uint256[50] private __gap;

    event ProtocolRegistered(
        ICrossChainRouter.Protocol indexed protocol,
        address moduleAddress,
        string version
    );

    event ProtocolUpdated(
        ICrossChainRouter.Protocol indexed protocol,
        address newModuleAddress,
        string newVersion
    );

    event ProtocolStatusChanged(
        ICrossChainRouter.Protocol indexed protocol,
        bool active,
        bool deprecated
    );

    event ChainSupportUpdated(
        ICrossChainRouter.Protocol indexed protocol,
        uint256 indexed chainId,
        bool supported
    );

    event ProtocolConfigUpdated(
        ICrossChainRouter.Protocol indexed protocol,
        bytes config
    );

    event HealthCheckPerformed(
        ICrossChainRouter.Protocol indexed protocol,
        bool healthy
    );

    function initialize(address _admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(REGISTRY_ADMIN_ROLE, _admin);
    }

    function registerProtocol(
        ICrossChainRouter.Protocol protocol,
        address moduleAddress,
        string memory version,
        uint256[] memory supportedChains
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(moduleAddress != address(0), "Invalid module address");
        require(protocols[protocol].moduleAddress == address(0), "Protocol already registered");

        protocols[protocol] = ProtocolInfo({
            moduleAddress: moduleAddress,
            version: version,
            active: true,
            deprecated: false,
            registeredAt: block.timestamp,
            lastHealthCheck: block.timestamp
        });

        for (uint256 i = 0; i < supportedChains.length; i++) {
            chainSupport[protocol][supportedChains[i]] = ChainSupport({
                supported: true,
                addedAt: block.timestamp,
                config: ""
            });
        }

        emit ProtocolRegistered(protocol, moduleAddress, version);
    }

    function updateProtocol(
        ICrossChainRouter.Protocol protocol,
        address newModuleAddress,
        string memory newVersion
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(protocols[protocol].moduleAddress != address(0), "Protocol not registered");
        require(newModuleAddress != address(0), "Invalid module address");

        protocols[protocol].moduleAddress = newModuleAddress;
        protocols[protocol].version = newVersion;

        emit ProtocolUpdated(protocol, newModuleAddress, newVersion);
    }

    function setProtocolStatus(
        ICrossChainRouter.Protocol protocol,
        bool active,
        bool deprecated
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(protocols[protocol].moduleAddress != address(0), "Protocol not registered");

        protocols[protocol].active = active;
        protocols[protocol].deprecated = deprecated;

        emit ProtocolStatusChanged(protocol, active, deprecated);
    }

    function updateChainSupport(
        ICrossChainRouter.Protocol protocol,
        uint256 chainId,
        bool supported,
        bytes calldata config
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(protocols[protocol].moduleAddress != address(0), "Protocol not registered");

        chainSupport[protocol][chainId] = ChainSupport({
            supported: supported,
            addedAt: block.timestamp,
            config: config
        });

        emit ChainSupportUpdated(protocol, chainId, supported);
    }

    function updateProtocolConfig(
        ICrossChainRouter.Protocol protocol,
        bytes calldata config
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(protocols[protocol].moduleAddress != address(0), "Protocol not registered");

        protocolConfigs[protocol] = config;
        emit ProtocolConfigUpdated(protocol, config);
    }

    function performHealthCheck(ICrossChainRouter.Protocol protocol) external {
        require(protocols[protocol].moduleAddress != address(0), "Protocol not registered");
        require(
            block.timestamp >= protocols[protocol].lastHealthCheck + HEALTH_CHECK_INTERVAL,
            "Health check too frequent"
        );

        protocols[protocol].lastHealthCheck = block.timestamp;

        // Basic health check - verify contract exists and responds
        address module = protocols[protocol].moduleAddress;
        uint256 size;
        assembly {
            size := extcodesize(module)
        }

        bool healthy = size > 0;
        
        if (!healthy && protocols[protocol].active) {
            protocols[protocol].active = false;
            emit ProtocolStatusChanged(protocol, false, protocols[protocol].deprecated);
        }

        emit HealthCheckPerformed(protocol, healthy);
    }

    function getProtocolInfo(
        ICrossChainRouter.Protocol protocol
    ) external view returns (
        address moduleAddress,
        string memory version,
        bool active,
        bool deprecated,
        uint256 registeredAt
    ) {
        ProtocolInfo memory info = protocols[protocol];
        return (
            info.moduleAddress,
            info.version,
            info.active,
            info.deprecated,
            info.registeredAt
        );
    }

    function isChainSupported(
        ICrossChainRouter.Protocol protocol,
        uint256 chainId
    ) external view returns (bool) {
        return chainSupport[protocol][chainId].supported;
    }

    function getChainConfig(
        ICrossChainRouter.Protocol protocol,
        uint256 chainId
    ) external view returns (bytes memory) {
        return chainSupport[protocol][chainId].config;
    }

    function getSupportedChains(
        ICrossChainRouter.Protocol protocol
    ) external view returns (uint256[] memory) {
        uint256 count = 0;
        uint256[] memory tempChains = new uint256[](100);

        for (uint256 chainId = 1; chainId < 100000; chainId++) {
            if (chainSupport[protocol][chainId].supported) {
                tempChains[count] = chainId;
                count++;
                if (count >= 100) break;
            }
        }

        uint256[] memory supportedChains = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            supportedChains[i] = tempChains[i];
        }

        return supportedChains;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}