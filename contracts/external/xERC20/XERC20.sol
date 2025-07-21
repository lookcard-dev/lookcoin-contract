// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IXERC20.sol";

contract XERC20 is Initializable, ERC20Upgradeable, AccessControlUpgradeable, IXERC20 {
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    
    struct Bridge {
        uint256 mintingMaxLimit;
        uint256 burningMaxLimit;
        uint256 mintingCurrentLimit;
        uint256 burningCurrentLimit;
        uint256 mintingLimitUpdateTime;
        uint256 burningLimitUpdateTime;
    }
    
    mapping(address => Bridge) public bridges;
    
    function initialize(
        string memory name,
        string memory symbol,
        address admin
    ) public initializer {
        __ERC20_init(name, symbol);
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
    
    function mint(address account, uint256 amount) external override onlyRole(BRIDGE_ROLE) {
        require(account != address(0), "XERC20: mint to zero address");
        Bridge storage bridge = bridges[msg.sender];
        
        uint256 currentLimit = _getCurrentLimit(
            bridge.mintingCurrentLimit,
            bridge.mintingMaxLimit,
            bridge.mintingLimitUpdateTime
        );
        
        require(currentLimit >= amount, "XERC20: exceeds minting limit");
        
        bridge.mintingCurrentLimit = currentLimit - amount;
        bridge.mintingLimitUpdateTime = block.timestamp;
        
        _mint(account, amount);
    }
    
    function burn(address account, uint256 amount) external override onlyRole(BRIDGE_ROLE) {
        require(account != address(0), "XERC20: burn from zero address");
        Bridge storage bridge = bridges[msg.sender];
        
        uint256 currentLimit = _getCurrentLimit(
            bridge.burningCurrentLimit,
            bridge.burningMaxLimit,
            bridge.burningLimitUpdateTime
        );
        
        require(currentLimit >= amount, "XERC20: exceeds burning limit");
        
        bridge.burningCurrentLimit = currentLimit - amount;
        bridge.burningLimitUpdateTime = block.timestamp;
        
        _burn(account, amount);
    }
    
    function setLimits(
        address bridge,
        uint256 mintingLimit,
        uint256 burningLimit
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bridge != address(0), "XERC20: invalid bridge");
        
        if (!hasRole(BRIDGE_ROLE, bridge)) {
            _grantRole(BRIDGE_ROLE, bridge);
            emit BridgeRegistered(bridge);
        }
        
        bridges[bridge].mintingMaxLimit = mintingLimit;
        bridges[bridge].burningMaxLimit = burningLimit;
        bridges[bridge].mintingLimitUpdateTime = block.timestamp;
        bridges[bridge].burningLimitUpdateTime = block.timestamp;
        
        emit BridgeLimitsSet(bridge, mintingLimit, burningLimit);
    }
    
    function mintingCurrentLimitOf(address bridge) external view override returns (uint256) {
        Bridge storage b = bridges[bridge];
        return _getCurrentLimit(b.mintingCurrentLimit, b.mintingMaxLimit, b.mintingLimitUpdateTime);
    }
    
    function burningCurrentLimitOf(address bridge) external view override returns (uint256) {
        Bridge storage b = bridges[bridge];
        return _getCurrentLimit(b.burningCurrentLimit, b.burningMaxLimit, b.burningLimitUpdateTime);
    }
    
    function mintingMaxLimitOf(address bridge) external view override returns (uint256) {
        return bridges[bridge].mintingMaxLimit;
    }
    
    function burningMaxLimitOf(address bridge) external view override returns (uint256) {
        return bridges[bridge].burningMaxLimit;
    }
    
    function _getCurrentLimit(
        uint256 currentLimit,
        uint256 maxLimit,
        uint256 lastUpdateTime
    ) private view returns (uint256) {
        if (lastUpdateTime == 0) return maxLimit;
        
        uint256 timePassed = block.timestamp - lastUpdateTime;
        uint256 limitIncrease = (maxLimit * timePassed) / 1 days;
        
        return currentLimit + limitIncrease > maxLimit ? maxLimit : currentLimit + limitIncrease;
    }
}