// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockLayerZeroEndpoint {
    mapping(uint16 => address) public destinations;
    address public ultraLightNode;
    
    // Attack simulation state variables
    bool public maliciousFeeMode;
    bool public messageExecutionFailure;
    bool public deprecatedFunctionMode;
    bool public incompatibleVersion;
    bool public payInLzTokenMode;
    address public maliciousRefundAddress;
    address public maliciousDVN;
    uint256 public gasPrice = 1e9; // 1 gwei default
    address[] public multipleDVNs;
    
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
    
    // State variables for improved testing
    mapping(uint16 => bytes32) public trustedRemotes;
    mapping(address => mapping(uint16 => uint64)) public nonces;
    bool public simulationMode = true;
    address[] public registeredDApps;
    
    event TrustedRemoteSet(uint16 chainId, bytes32 path);
    event MessageVerified(bytes32 guid, bool success);
    
    function setDestination(uint16 _chainId, address _destination) external {
        destinations[_chainId] = _destination;
        registeredDApps.push(_destination);
    }
    
    // Register a dApp for cross-chain operations
    function registerDApp(address _dapp) external {
        registeredDApps.push(_dapp);
    }
    
    // Check if dApp is registered
    function isDAppRegistered(address _dapp) external view returns (bool) {
        for (uint i = 0; i < registeredDApps.length; i++) {
            if (registeredDApps[i] == _dapp) {
                return true;
            }
        }
        return false;
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
    
    // Legacy naming for compatibility
    function estimatedFees(
        uint16 _dstChainId,
        address _userApplication,
        bytes calldata _payload,
        bool _payInZRO,
        bytes calldata _adapterParam
    ) external view returns (uint nativeFee, uint zroFee) {
        return (0.01 ether, 0);
    }
    
    // Enhanced simulation methods for testing
    mapping(address => mapping(uint16 => mapping(address => uint64))) public outboundNonces;
    mapping(address => mapping(uint16 => mapping(uint64 => bool))) public processedInbound;
    
    function simulateReceive(
        address _target,
        uint16 _srcChainId,
        address _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external {
        require(_target != address(0), "Invalid target");
        require(!processedInbound[_target][_srcChainId][_nonce], "LayerZero: message already processed");
        
        processedInbound[_target][_srcChainId][_nonce] = true;
        
        // Create proper trusted remote path
        bytes memory trustedRemotePath = abi.encodePacked(_srcAddress, _target);
        
        // Call lzReceive on the target with proper path format
        (bool success,) = _target.call(
            abi.encodeWithSignature(
                "lzReceive(uint16,bytes,uint64,bytes)",
                _srcChainId,
                trustedRemotePath,
                _nonce,
                _payload
            )
        );
        
        require(success, "lzReceive call failed");
        emit PacketReceived(_srcChainId, trustedRemotePath, _target, _payload);
    }
    
    // Enhanced trusted remote management
    function setTrustedRemote(uint16 _chainId, bytes32 _path) external {
        trustedRemotes[_chainId] = _path;
        emit TrustedRemoteSet(_chainId, _path);
    }
    
    function getTrustedRemote(uint16 _chainId) external view returns (bytes32) {
        return trustedRemotes[_chainId];
    }
    
    // Network state simulation
    function setNetworkCongestion(uint256 _level) external {
        // Adjust gas prices based on congestion
        gasPrice = 1e9 + (_level * 5e8); // Base 1 gwei + congestion
    }
    
    // Cross-chain message validation
    function validateTrustedRemote(uint16 _srcChainId, bytes calldata _srcAddress) external view returns (bool) {
        bytes32 trustedPath = trustedRemotes[_srcChainId];
        if (trustedPath == bytes32(0)) {
            return false;
        }
        
        // Extract address from path (first 20 bytes)
        address trustedAddress = address(bytes20(trustedPath));
        address srcAddress = address(bytes20(_srcAddress[0:20]));
        
        return trustedAddress == srcAddress;
    }
    
    function getOutboundNonce(address _target, uint16 _dstChainId) external view returns (uint64) {
        return outboundNonces[_target][_dstChainId][address(0)];
    }
    
    function incrementOutboundNonce(address _target, uint16 _dstChainId) external {
        outboundNonces[_target][_dstChainId][address(0)]++;
    }
    
    // Edge case testing methods
    function setMaliciousDVN(address _dvn) external {
        maliciousDVN = _dvn;
    }
    
    function setMaliciousFee(bool _enabled, uint256 _feeAmount) external {
        maliciousFeeMode = _enabled;
        if (_enabled && _feeAmount == 0) {
            gasPrice = 0; // Simulate underflow
        }
    }
    
    function setMessageExecutionFailure(bool _fail) external {
        messageExecutionFailure = _fail;
    }
    
    function setDeprecatedFunctionMode(bool _deprecated) external {
        deprecatedFunctionMode = _deprecated;
    }
    
    function setIncompatibleVersion(bool _incompatible) external {
        incompatibleVersion = _incompatible;
    }
    
    function setPayInLzToken(bool _payInToken) external {
        payInLzTokenMode = _payInToken;
    }
    
    function setMaliciousRefundAddress(address _refund) external {
        maliciousRefundAddress = _refund;
    }
    
    function setGasPrice(uint256 _price) external {
        gasPrice = _price;
    }
    
    function setMultipleDVNs(address[] calldata _dvns) external {
        // Clear existing DVNs
        delete multipleDVNs;
        // Copy DVNs one by one
        for (uint256 i = 0; i < _dvns.length; i++) {
            multipleDVNs.push(_dvns[i]);
        }
    }
    
    function setDVN(address _dvn) external {
        maliciousDVN = _dvn;
    }
}

contract MockDVN {
    mapping(bytes32 => bool) public verifiedMessages;
    bool public invalidSignatureMode;
    bool public conflictingBehavior;
    
    function verify(bytes32 _messageHash) external {
        if (invalidSignatureMode) {
            revert("DVNSignatureValidationFailed");
        }
        if (conflictingBehavior) {
            revert("DVNCoordinationFailure");
        }
        verifiedMessages[_messageHash] = true;
    }
    
    function isVerified(bytes32 _messageHash) external view returns (bool) {
        return verifiedMessages[_messageHash];
    }
    
    function setInvalidSignatureMode(bool _invalid) external {
        invalidSignatureMode = _invalid;
    }
    
    function setConflictingBehavior(bool _conflicting) external {
        conflictingBehavior = _conflicting;
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