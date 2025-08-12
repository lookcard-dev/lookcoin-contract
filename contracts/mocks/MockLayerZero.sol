// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockLayerZeroEndpoint {
    mapping(uint16 => address) public destinations;
    address public ultraLightNode;
    
    event PacketSent(uint16 dstChainId, bytes path, bytes payload, uint256 nativeFee);
    event PacketReceived(uint16 srcChainId, bytes srcAddress, address dstAddress, bytes payload);
    
    // LayerZero V2 structures
    struct MessagingParams {
        uint32 dstEid;
        bytes32 receiver;
        bytes message;
        bytes options;
        bool payInLzToken;
    }
    
    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;      
        MessagingFee fee;
    }
    
    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }
    
    function setDestination(uint16 _chainId, address _destination) external {
        destinations[_chainId] = _destination;
    }
    
    function setUltraLightNode(address _ulNode) external {
        ultraLightNode = _ulNode;
    }
    
    // LayerZero V2 send function
    function send(
        MessagingParams calldata _params,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory) {
        emit PacketSent(uint16(_params.dstEid), abi.encodePacked(_params.receiver), _params.message, msg.value);
        
        return MessagingReceipt({
            guid: keccak256(abi.encodePacked(block.timestamp, _params.dstEid, _params.message)),
            nonce: uint64(block.number),
            fee: MessagingFee({
                nativeFee: msg.value,
                lzTokenFee: 0
            })
        });
    }
    
    // LayerZero V2 quote function  
    function quote(
        MessagingParams calldata _params,
        address _sender
    ) external view returns (MessagingFee memory) {
        return MessagingFee({
            nativeFee: 0.01 ether,
            lzTokenFee: 0
        });
    }
    
    // Legacy V1 send function for backward compatibility
    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable {
        emit PacketSent(_dstChainId, _destination, _payload, msg.value);
    }
    
    function receivePayload(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        address _dstAddress,
        uint64 _nonce,
        uint _gasLimit,
        bytes calldata _payload
    ) external {
        emit PacketReceived(_srcChainId, _srcAddress, _dstAddress, _payload);
    }
    
    function estimateFees(
        uint16 _dstChainId,
        address _userApplication,
        bytes calldata _payload,
        bool _payInZRO,
        bytes calldata _adapterParam
    ) external view returns (uint nativeFee, uint zroFee) {
        return (0.01 ether, 0);
    }
}

contract MockDVN {
    mapping(bytes32 => bool) public verifiedMessages;
    
    function verify(bytes32 _messageHash) external {
        verifiedMessages[_messageHash] = true;
    }
    
    function isVerified(bytes32 _messageHash) external view returns (bool) {
        return verifiedMessages[_messageHash];
    }
}

contract MockUltraLightNode {
    uint16 public chainId;
    mapping(uint16 => uint) public chainConfigs;
    
    constructor(uint16 _chainId) {
        chainId = _chainId;
    }
    
    function setConfig(uint16 _remoteChainId, uint _config) external {
        chainConfigs[_remoteChainId] = _config;
    }
    
    function getConfig(uint16 _remoteChainId) external view returns (uint) {
        return chainConfigs[_remoteChainId];
    }
}