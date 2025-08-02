// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MinimalTimelock
 * @dev Minimal timelock contract for LookCoin governance
 * @notice Provides time-delayed execution of administrative functions
 */
contract MinimalTimelock is AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    uint256 public constant MIN_DELAY = 2 days;
    
    mapping(bytes32 => uint256) private _timestamps;
    
    event CallScheduled(
        bytes32 indexed id,
        address indexed target,
        uint256 value,
        bytes data,
        uint256 delay,
        uint256 timestamp
    );
    
    event CallExecuted(bytes32 indexed id);
    event CallCancelled(bytes32 indexed id);
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        _grantRole(CANCELLER_ROLE, admin);
    }
    
    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 delay
    ) public onlyRole(PROPOSER_ROLE) returns (bytes32) {
        require(delay >= MIN_DELAY, "MinimalTimelock: insufficient delay");
        
        bytes32 id = hashOperation(target, value, data);
        require(_timestamps[id] == 0, "MinimalTimelock: operation already scheduled");
        
        _timestamps[id] = block.timestamp + delay;
        
        emit CallScheduled(id, target, value, data, delay, block.timestamp);
        
        return id;
    }
    
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) public payable onlyRole(EXECUTOR_ROLE) {
        bytes32 id = hashOperation(target, value, data);
        
        require(_timestamps[id] > 0, "MinimalTimelock: operation not scheduled");
        require(block.timestamp >= _timestamps[id], "MinimalTimelock: operation not ready");
        
        delete _timestamps[id];
        
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        require(success, string(returndata));
        
        emit CallExecuted(id);
    }
    
    function cancel(bytes32 id) public onlyRole(CANCELLER_ROLE) {
        require(_timestamps[id] > 0, "MinimalTimelock: operation not scheduled");
        
        delete _timestamps[id];
        
        emit CallCancelled(id);
    }
    
    function hashOperation(
        address target,
        uint256 value,
        bytes calldata data
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data));
    }
    
    function getTimestamp(bytes32 id) public view returns (uint256) {
        return _timestamps[id];
    }
    
    function isOperation(bytes32 id) public view returns (bool) {
        return _timestamps[id] > 0;
    }
    
    function isOperationPending(bytes32 id) public view returns (bool) {
        return _timestamps[id] > 0 && _timestamps[id] > block.timestamp;
    }
    
    function isOperationReady(bytes32 id) public view returns (bool) {
        return _timestamps[id] > 0 && _timestamps[id] <= block.timestamp;
    }
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    receive() external payable {}
}