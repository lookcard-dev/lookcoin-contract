// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockHyperlaneMailbox {
    mapping(address => bool) public authorizedCallers;
    bytes32 public constant MESSAGE_VERSION = bytes32(uint256(1));
    uint32 public localDomain = 56; // BSC by default
    
    event Dispatch(
        address indexed sender,
        uint32 indexed destinationDomain,
        bytes32 indexed recipientAddress,
        bytes message
    );
    
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32) {
        bytes32 messageId = keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            destinationDomain,
            recipientAddress,
            messageBody
        ));
        
        emit Dispatch(msg.sender, destinationDomain, recipientAddress, messageBody);
        return messageId;
    }
    
    function deliverMessage(
        address recipient,
        uint32 origin,
        bytes32 sender,
        bytes calldata message
    ) external {
        require(authorizedCallers[msg.sender], "Unauthorized");
        
        // Call the recipient's handle function
        (bool success, ) = recipient.call(
            abi.encodeWithSignature(
                "handle(uint32,bytes32,bytes)",
                origin,
                sender,
                message
            )
        );
        require(success, "Message delivery failed");
    }
    
    function setAuthorizedCaller(address caller, bool authorized) external {
        authorizedCallers[caller] = authorized;
    }
}

contract MockHyperlaneGasPaymaster {
    mapping(uint32 => uint256) public gasPrice;
    
    event GasPayment(
        bytes32 indexed messageId,
        uint256 gasAmount,
        uint256 payment
    );
    
    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address refundAddress
    ) external payable {
        uint256 requiredPayment = gasAmount * gasPrice[destinationDomain] / 1e18;
        require(msg.value >= requiredPayment, "Insufficient payment");
        
        emit GasPayment(messageId, gasAmount, msg.value);
        
        // Refund excess
        if (msg.value > requiredPayment) {
            payable(refundAddress).transfer(msg.value - requiredPayment);
        }
    }
    
    function quoteGasPayment(
        uint32 destinationDomain,
        uint256 gasAmount
    ) external view returns (uint256) {
        return gasAmount * gasPrice[destinationDomain] / 1e18;
    }
    
    function setGasPrice(uint32 domain, uint256 price) external {
        gasPrice[domain] = price;
    }
}

contract MockInterchainSecurityModule {
    uint8 public moduleType = 1; // MULTISIG type
    uint8 public threshold = 2;
    
    function verify(
        bytes calldata metadata,
        bytes calldata message
    ) external pure returns (bool) {
        // Mock verification - always return true for testing
        return true;
    }
    
    function verifyMessageId(
        bytes32 messageId,
        bytes calldata metadata
    ) external pure returns (bool) {
        return true;
    }
}