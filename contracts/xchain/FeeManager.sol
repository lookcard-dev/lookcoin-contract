// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../interfaces/ICrossChainRouter.sol";

contract FeeManager is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");
    
    struct FeeCache {
        uint256 fee;
        uint256 timestamp;
        bool valid;
    }

    struct ChainGasPrice {
        uint256 gasPrice;
        uint256 timestamp;
    }

    mapping(ICrossChainRouter.Protocol => address) public protocolModules;
    mapping(uint256 => mapping(ICrossChainRouter.Protocol => FeeCache)) public feeCache;
    mapping(uint256 => ChainGasPrice) public chainGasPrices;
    
    uint256 public constant CACHE_TTL = 5 minutes;
    uint256 public constant BASE_GAS_COST = 100000;
    
    mapping(ICrossChainRouter.Protocol => uint256) public protocolMultipliers;
    mapping(ICrossChainRouter.Protocol => uint256) public protocolBaseFees;

    uint256[50] private __gap;

    event FeeEstimated(
        ICrossChainRouter.Protocol indexed protocol,
        uint256 indexed destinationChain,
        uint256 amount,
        uint256 fee
    );

    event GasPriceUpdated(uint256 indexed chainId, uint256 gasPrice);
    event ProtocolModuleUpdated(ICrossChainRouter.Protocol indexed protocol, address module);
    event ProtocolFeesUpdated(ICrossChainRouter.Protocol indexed protocol, uint256 multiplier, uint256 baseFee);

    function initialize(address _admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FEE_ADMIN_ROLE, _admin);

        // Initialize default multipliers (basis points, 10000 = 100%)
        protocolMultipliers[ICrossChainRouter.Protocol.LayerZero] = 10000;
        protocolMultipliers[ICrossChainRouter.Protocol.Celer] = 11000;
        protocolMultipliers[ICrossChainRouter.Protocol.XERC20] = 9000;
        protocolMultipliers[ICrossChainRouter.Protocol.Hyperlane] = 10500;

        // Initialize base fees (in wei)
        protocolBaseFees[ICrossChainRouter.Protocol.LayerZero] = 0.001 ether;
        protocolBaseFees[ICrossChainRouter.Protocol.Celer] = 0.0015 ether;
        protocolBaseFees[ICrossChainRouter.Protocol.XERC20] = 0.0008 ether;
        protocolBaseFees[ICrossChainRouter.Protocol.Hyperlane] = 0.0012 ether;
    }

    function estimateFee(
        ICrossChainRouter.Protocol protocol,
        uint256 destinationChain,
        uint256 amount
    ) external returns (uint256) {
        // Check cache first
        FeeCache memory cached = feeCache[destinationChain][protocol];
        if (cached.valid && block.timestamp - cached.timestamp < CACHE_TTL) {
            return cached.fee;
        }

        uint256 fee = _calculateFee(protocol, destinationChain, amount);
        
        // Update cache
        feeCache[destinationChain][protocol] = FeeCache({
            fee: fee,
            timestamp: block.timestamp,
            valid: true
        });

        emit FeeEstimated(protocol, destinationChain, amount, fee);
        return fee;
    }

    function compareProtocolFees(
        uint256 destinationChain,
        uint256 amount
    ) external returns (uint256[] memory fees) {
        fees = new uint256[](4);
        
        for (uint8 i = 0; i < 4; i++) {
            ICrossChainRouter.Protocol protocol = ICrossChainRouter.Protocol(i);
            address module = protocolModules[protocol];
            
            if (module != address(0)) {
                try ILookBridgeModule(module).estimateFee(destinationChain, amount, "") 
                returns (uint256 fee, uint256) {
                    fees[i] = fee;
                } catch {
                    fees[i] = type(uint256).max;
                }
            } else {
                fees[i] = type(uint256).max;
            }
        }
    }

    function updateGasPrice(uint256 chainId, uint256 gasPrice) external onlyRole(FEE_ADMIN_ROLE) {
        chainGasPrices[chainId] = ChainGasPrice({
            gasPrice: gasPrice,
            timestamp: block.timestamp
        });
        emit GasPriceUpdated(chainId, gasPrice);
    }

    function updateProtocolModule(
        ICrossChainRouter.Protocol protocol,
        address module
    ) external onlyRole(FEE_ADMIN_ROLE) {
        protocolModules[protocol] = module;
        emit ProtocolModuleUpdated(protocol, module);
    }

    function updateProtocolFees(
        ICrossChainRouter.Protocol protocol,
        uint256 multiplier,
        uint256 baseFee
    ) external onlyRole(FEE_ADMIN_ROLE) {
        require(multiplier > 0 && multiplier <= 20000, "Invalid multiplier");
        protocolMultipliers[protocol] = multiplier;
        protocolBaseFees[protocol] = baseFee;
        emit ProtocolFeesUpdated(protocol, multiplier, baseFee);
    }

    function invalidateCache(uint256 chainId, ICrossChainRouter.Protocol protocol) external onlyRole(FEE_ADMIN_ROLE) {
        feeCache[chainId][protocol].valid = false;
    }

    function _calculateFee(
        ICrossChainRouter.Protocol protocol,
        uint256 destinationChain,
        uint256 amount
    ) private view returns (uint256) {
        // Get base protocol fee
        address module = protocolModules[protocol];
        uint256 baseFee = protocolBaseFees[protocol];
        
        if (module != address(0)) {
            try ILookBridgeModule(module).estimateFee(destinationChain, amount, "") 
            returns (uint256 protocolFee, uint256) {
                baseFee = protocolFee;
            } catch {}
        }

        // Apply protocol multiplier
        uint256 adjustedFee = (baseFee * protocolMultipliers[protocol]) / 10000;

        // Add destination chain gas cost if available
        ChainGasPrice memory destGas = chainGasPrices[destinationChain];
        if (destGas.gasPrice > 0 && block.timestamp - destGas.timestamp < 1 hours) {
            uint256 gasCost = BASE_GAS_COST * destGas.gasPrice;
            adjustedFee += gasCost;
        }

        return adjustedFee;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}