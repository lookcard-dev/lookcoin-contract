// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TestRouter
 * @dev Simplified test router for attack testing
 * @notice Mock router that accepts bridgeToken calls for testing advanced attack scenarios
 */
contract TestRouter is AccessControl, Pausable, ReentrancyGuard {
    enum Protocol {
        LayerZero,
        Celer,
        Hyperlane
    }

    bytes32 public constant PROTOCOL_ADMIN_ROLE = keccak256("PROTOCOL_ADMIN_ROLE");
    bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");

    mapping(uint8 => bool) public protocolActive;
    address public lookCoin;
    uint256 private transferNonce;

    event BridgeTokenCalled(uint8 protocol, uint256 chain, address recipient, uint256 amount);
    event ProtocolPaused(uint8 protocol);

    constructor(address _lookCoin, address _admin) {
        lookCoin = _lookCoin;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PROTOCOL_ADMIN_ROLE, _admin);
        
        // Enable all protocols by default
        protocolActive[0] = true; // LayerZero
        protocolActive[1] = true; // Celer
        protocolActive[2] = true; // Hyperlane
    }

    /**
     * @dev Bridge tokens - main method for attack testing
     */
    function bridgeToken(
        uint8 protocol,
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata data
    ) external payable whenNotPaused nonReentrant returns (bytes32) {
        require(protocol <= 2, "Invalid protocol");
        require(protocolActive[protocol], "Protocol not active");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        
        // Transfer tokens from sender
        IERC20(lookCoin).transferFrom(msg.sender, address(this), amount);
        
        // Create transfer ID
        bytes32 transferId = keccak256(abi.encodePacked(msg.sender, transferNonce++, block.timestamp));
        
        emit BridgeTokenCalled(protocol, destinationChain, recipient, amount);
        
        return transferId;
    }

    function pauseProtocol(uint8 protocol) external {
        require(protocol <= 2, "Invalid protocol");
        protocolActive[protocol] = false;
        emit ProtocolPaused(protocol);
    }

    function unpauseProtocol(uint8 protocol) external {
        protocolActive[protocol] = true;
    }

    receive() external payable {}
}