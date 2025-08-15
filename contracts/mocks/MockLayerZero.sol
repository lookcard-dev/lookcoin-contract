// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockLayerZeroEndpoint
 * @dev Enhanced LayerZero V2 mock endpoint with comprehensive DVN simulation
 */
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
    
    // DVN simulation state
    mapping(bytes32 => DVNVerification) public dvnVerifications;
    mapping(address => bool) public authorizedDVNs;
    mapping(bytes32 => uint256) public messageConfirmations;
    uint256 public requiredConfirmations = 2;
    bool public dvnFailureMode;
    
    // Network simulation
    uint256 public networkLatency;
    bool public networkCongestionMode;
    mapping(uint16 => uint256) public chainGasPrices;
    
    struct DVNVerification {
        bytes32 messageHash;
        uint256 confirmationCount;
        mapping(address => bool) hasConfirmed;
        bool isComplete;
        uint256 timestamp;
    }
    
    event PacketSent(uint16 dstChainId, bytes path, bytes payload, uint256 nativeFee);
    event PacketReceived(uint16 srcChainId, bytes srcAddress, address dstAddress, bytes payload);
    event DVNVerificationStarted(bytes32 indexed messageHash, uint16 srcChain, uint16 dstChain);
    event DVNConfirmation(bytes32 indexed messageHash, address dvn, uint256 confirmationCount);
    event MessageVerificationComplete(bytes32 indexed messageHash, bool success);
    
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
    
    // Enhanced V2 structures for DVN simulation
    struct DVNConfig {
        address dvnAddress;
        bool required;
        uint256 threshold;
        uint256 quorum;
    }
    
    struct ExecuteParams {
        bytes32 origin;
        bytes32 receiver;
        bytes32 guid;
        bytes message;
        bytes extraData;
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
    
    // LayerZero V2 send function with DVN verification
    function send(
        MessagingParams calldata _params,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory) {
        // Simulate network congestion delay
        if (networkCongestionMode && networkLatency > 0) {
            // In real implementation, this would be handled by DVNs
            require(msg.value >= estimateGasCost(_params.dstEid), "InsufficientGasForCongestion");
        }
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            block.timestamp, 
            _params.dstEid, 
            _params.receiver,
            _params.message
        ));
        
        // Start DVN verification process
        _initiateDVNVerification(messageHash, uint16(block.chainid), uint16(_params.dstEid));
        
        emit PacketSent(uint16(_params.dstEid), abi.encodePacked(_params.receiver), _params.message, msg.value);
        
        return MessagingReceipt({
            guid: messageHash,
            nonce: uint64(block.number),
            fee: MessagingFee({
                nativeFee: msg.value,
                lzTokenFee: 0
            })
        });
    }
    
    // LayerZero V2 quote function with dynamic pricing
    function quote(
        MessagingParams calldata _params,
        address _sender
    ) external view returns (MessagingFee memory) {
        uint256 baseFee = 0.01 ether;
        
        // Apply network congestion multiplier
        if (networkCongestionMode) {
            baseFee = baseFee * (100 + networkLatency) / 100;
        }
        
        // Apply chain-specific gas pricing
        uint256 chainGasPrice = chainGasPrices[uint16(_params.dstEid)];
        if (chainGasPrice > 0) {
            baseFee = baseFee * chainGasPrice / gasPrice;
        }
        
        return MessagingFee({
            nativeFee: baseFee,
            lzTokenFee: 0
        });
    }
    
    // Estimate gas cost based on destination chain
    function estimateGasCost(uint32 _dstEid) public view returns (uint256) {
        uint256 baseGas = 200000;
        uint256 chainMultiplier = chainGasPrices[uint16(_dstEid)];
        if (chainMultiplier == 0) chainMultiplier = gasPrice;
        
        return (baseGas * chainMultiplier) / 1e9; // Convert to wei
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
        // Enhanced fee calculation with validation
        require(_userApplication != address(0), "InvalidUserApplication");
        
        uint256 baseFee = 0.01 ether;
        
        // Apply congestion and chain-specific pricing
        if (networkCongestionMode) {
            baseFee = baseFee * (100 + networkLatency) / 100;
        }
        
        uint256 chainGasPrice = chainGasPrices[_dstChainId];
        if (chainGasPrice > 0) {
            baseFee = baseFee * chainGasPrice / gasPrice;
        }
        
        // Parse adapter params for gas limit (simplified for mock)
        if (_adapterParam.length >= 34) {
            // For testing, extract a gas multiplier from adapter params length
            uint256 gasMultiplier = _adapterParam.length > 100 ? 3 : 
                                   _adapterParam.length > 50 ? 2 : 1;
            baseFee = baseFee * gasMultiplier;
        }
        
        return (baseFee, 0);
    }
    
    // Legacy naming for compatibility with enhanced validation
    function estimatedFees(
        uint16 _dstChainId,
        address _userApplication,
        bytes calldata _payload,
        bool _payInZRO,
        bytes calldata _adapterParam
    ) external view returns (uint nativeFee, uint zroFee) {
        return this.estimateFees(_dstChainId, _userApplication, _payload, _payInZRO, _adapterParam);
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
        require(_target != address(0), "InvalidTarget");
        require(!processedInbound[_target][_srcChainId][_nonce], "NonceAlreadyProcessed");
        
        // Create message hash for DVN verification
        bytes32 messageHash = keccak256(abi.encodePacked(
            _srcChainId,
            _srcAddress,
            _target,
            _nonce,
            _payload
        ));
        
        // Verify DVN confirmations if enabled
        if (authorizedDVNs[msg.sender] || dvnVerifications[messageHash].isComplete) {
            // DVN verified path
            require(dvnVerifications[messageHash].confirmationCount >= requiredConfirmations, "InsufficientDVNConfirmations");
        } else if (multipleDVNs.length > 0) {
            // Simulate DVN verification delay
            _simulateDVNVerification(messageHash);
        }
        
        processedInbound[_target][_srcChainId][_nonce] = true;
        
        // Enhanced trusted remote path validation
        bytes memory trustedRemotePath = abi.encodePacked(_srcAddress, _target);
        
        // Validate trusted remote if configured
        if (trustedRemotes[_srcChainId] != bytes32(0)) {
            require(this.validateTrustedRemote(_srcChainId, abi.encodePacked(_srcAddress)), "UntrustedRemoteAddress");
        }
        
        // Simulate network latency
        if (networkLatency > 0) {
            // In tests, this represents processing delay
            emit MessageVerificationComplete(messageHash, true);
        }
        
        // Call lzReceive with enhanced error handling
        (bool success, bytes memory returnData) = _target.call(
            abi.encodeWithSignature(
                "lzReceive(uint16,bytes,uint64,bytes)",
                _srcChainId,
                trustedRemotePath,
                _nonce,
                _payload
            )
        );
        
        if (!success) {
            // Enhanced error reporting
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    revert(add(32, returnData), returnDataSize)
                }
            } else {
                revert("lzReceiveCallFailed");
            }
        }
        
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
        
        // Extract address from trusted path (last 20 bytes of bytes32, right-aligned)
        address trustedAddress = address(uint160(uint256(trustedPath)));
        
        // Extract address from source address bytes
        if (_srcAddress.length < 20) {
            return false;
        }
        
        // Convert bytes to address (take first 20 bytes)
        address srcAddress = address(bytes20(_srcAddress[:20]));
        
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
        // Copy DVNs and authorize them
        for (uint256 i = 0; i < _dvns.length; i++) {
            require(_dvns[i] != address(0), "InvalidDVNAddress");
            multipleDVNs.push(_dvns[i]);
            authorizedDVNs[_dvns[i]] = true;
        }
    }
    
    function setDVN(address _dvn) external {
        require(_dvn != address(0), "InvalidDVNAddress");
        maliciousDVN = _dvn;
        authorizedDVNs[_dvn] = true;
    }
    
    // DVN Management Functions
    function authorizeDVN(address _dvn, bool _authorized) external {
        require(_dvn != address(0), "InvalidDVNAddress");
        authorizedDVNs[_dvn] = _authorized;
    }
    
    function setRequiredConfirmations(uint256 _required) external {
        require(_required > 0 && _required <= 10, "InvalidConfirmationCount");
        requiredConfirmations = _required;
    }
    
    function setDVNFailureMode(bool _failureMode) external {
        dvnFailureMode = _failureMode;
    }
    
    // Network Simulation Functions
    function setNetworkLatency(uint256 _latency) external {
        require(_latency <= 100, "LatencyTooHigh");
        networkLatency = _latency;
    }
    
    function setNetworkCongestionMode(bool _congestionMode) external {
        networkCongestionMode = _congestionMode;
    }
    
    function setChainGasPrice(uint16 _chainId, uint256 _gasPrice) external {
        require(_gasPrice > 0, "InvalidGasPrice");
        chainGasPrices[_chainId] = _gasPrice;
    }
    
    // DVN Verification Internal Functions
    function _initiateDVNVerification(bytes32 _messageHash, uint16 _srcChain, uint16 _dstChain) internal {
        DVNVerification storage verification = dvnVerifications[_messageHash];
        verification.messageHash = _messageHash;
        verification.timestamp = block.timestamp;
        
        emit DVNVerificationStarted(_messageHash, _srcChain, _dstChain);
        
        // Auto-confirm if no DVNs configured or in test mode
        if (multipleDVNs.length == 0) {
            verification.isComplete = true;
            verification.confirmationCount = requiredConfirmations;
        }
    }
    
    function _simulateDVNVerification(bytes32 _messageHash) internal {
        if (dvnFailureMode) {
            revert("DVNVerificationFailed");
        }
        
        DVNVerification storage verification = dvnVerifications[_messageHash];
        
        // Simulate confirmations from configured DVNs
        for (uint256 i = 0; i < multipleDVNs.length && i < requiredConfirmations; i++) {
            address dvn = multipleDVNs[i];
            if (!verification.hasConfirmed[dvn]) {
                verification.hasConfirmed[dvn] = true;
                verification.confirmationCount++;
                emit DVNConfirmation(_messageHash, dvn, verification.confirmationCount);
            }
        }
        
        if (verification.confirmationCount >= requiredConfirmations) {
            verification.isComplete = true;
        }
    }
    
    // Public DVN interaction functions
    function confirmMessage(bytes32 _messageHash) external {
        require(authorizedDVNs[msg.sender], "UnauthorizedDVN");
        
        DVNVerification storage verification = dvnVerifications[_messageHash];
        
        // Initialize verification if it doesn't exist
        if (verification.messageHash == bytes32(0)) {
            verification.messageHash = _messageHash;
            verification.timestamp = block.timestamp;
        }
        
        require(!verification.hasConfirmed[msg.sender], "AlreadyConfirmed");
        
        verification.hasConfirmed[msg.sender] = true;
        verification.confirmationCount++;
        
        emit DVNConfirmation(_messageHash, msg.sender, verification.confirmationCount);
        
        if (verification.confirmationCount >= requiredConfirmations) {
            verification.isComplete = true;
            emit MessageVerificationComplete(_messageHash, true);
        }
    }
    
    // View functions for DVN state
    function getVerificationStatus(bytes32 _messageHash) external view returns (
        uint256 confirmationCount,
        bool isComplete,
        uint256 timestamp
    ) {
        DVNVerification storage verification = dvnVerifications[_messageHash];
        return (verification.confirmationCount, verification.isComplete, verification.timestamp);
    }
    
    function hasConfirmed(bytes32 _messageHash, address _dvn) external view returns (bool) {
        return dvnVerifications[_messageHash].hasConfirmed[_dvn];
    }
}

/**
 * @title MockDVN
 * @dev Enhanced Decentralized Verifier Network mock with realistic behavior
 */
contract MockDVN {
    mapping(bytes32 => bool) public verifiedMessages;
    mapping(bytes32 => uint256) public verificationTimestamps;
    mapping(bytes32 => bytes32) public messageSignatures;
    
    bool public invalidSignatureMode;
    bool public conflictingBehavior;
    bool public delayedVerification;
    uint256 public verificationDelay = 0;
    uint256 public signatureThreshold = 1;
    
    address public endpoint;
    string public dvnIdentifier;
    uint256 public verificationCount;
    
    event MessageVerified(bytes32 indexed messageHash, bytes32 signature, uint256 timestamp);
    event VerificationFailed(bytes32 indexed messageHash, string reason);
    event DVNConfigurationUpdated(string parameter, uint256 value);
    
    constructor(string memory _identifier) {
        dvnIdentifier = _identifier;
    }
    
    function setEndpoint(address _endpoint) external {
        require(_endpoint != address(0), "InvalidEndpoint");
        endpoint = _endpoint;
    }
    
    function verify(bytes32 _messageHash) external {
        return verifyWithSignature(_messageHash, keccak256(abi.encodePacked(_messageHash, block.timestamp)));
    }
    
    function verifyWithSignature(bytes32 _messageHash, bytes32 _signature) public {
        if (invalidSignatureMode) {
            emit VerificationFailed(_messageHash, "DVNSignatureValidationFailed");
            revert("DVNSignatureValidationFailed");
        }
        
        if (conflictingBehavior) {
            emit VerificationFailed(_messageHash, "DVNCoordinationFailure");
            revert("DVNCoordinationFailure");
        }
        
        if (delayedVerification && verificationDelay > 0) {
            // Initialize timestamp if not set
            if (verificationTimestamps[_messageHash] == 0) {
                verificationTimestamps[_messageHash] = block.timestamp;
                revert("VerificationDelayNotMet");
            }
            require(block.timestamp >= verificationTimestamps[_messageHash] + verificationDelay, "VerificationDelayNotMet");
        }
        
        // Simulate signature validation
        if (_signature == bytes32(0)) {
            emit VerificationFailed(_messageHash, "InvalidSignature");
            revert("InvalidSignature");
        }
        
        verifiedMessages[_messageHash] = true;
        verificationTimestamps[_messageHash] = block.timestamp;
        messageSignatures[_messageHash] = _signature;
        verificationCount++;
        
        emit MessageVerified(_messageHash, _signature, block.timestamp);
        
        // Notify endpoint if configured
        if (endpoint != address(0)) {
            try MockLayerZeroEndpoint(endpoint).confirmMessage(_messageHash) {
                // Confirmation sent successfully
            } catch {
                // Endpoint confirmation failed - non-critical
            }
        }
    }
    
    function isVerified(bytes32 _messageHash) external view returns (bool) {
        return verifiedMessages[_messageHash];
    }
    
    function getVerificationDetails(bytes32 _messageHash) external view returns (
        bool verified,
        uint256 timestamp,
        bytes32 signature
    ) {
        return (
            verifiedMessages[_messageHash],
            verificationTimestamps[_messageHash],
            messageSignatures[_messageHash]
        );
    }
    
    // Configuration functions
    function setInvalidSignatureMode(bool _invalid) external {
        invalidSignatureMode = _invalid;
        emit DVNConfigurationUpdated("invalidSignatureMode", _invalid ? 1 : 0);
    }
    
    function setConflictingBehavior(bool _conflicting) external {
        conflictingBehavior = _conflicting;
        emit DVNConfigurationUpdated("conflictingBehavior", _conflicting ? 1 : 0);
    }
    
    function setDelayedVerification(bool _delayed, uint256 _delay) external {
        delayedVerification = _delayed;
        verificationDelay = _delay;
        emit DVNConfigurationUpdated("verificationDelay", _delay);
    }
    
    function setSignatureThreshold(uint256 _threshold) external {
        require(_threshold > 0 && _threshold <= 10, "InvalidThreshold");
        signatureThreshold = _threshold;
        emit DVNConfigurationUpdated("signatureThreshold", _threshold);
    }
    
    // Bulk verification for testing
    function verifyMultiple(bytes32[] calldata _messageHashes) external {
        for (uint256 i = 0; i < _messageHashes.length; i++) {
            bytes32 signature = keccak256(abi.encodePacked(_messageHashes[i], block.timestamp, i));
            verifyWithSignature(_messageHashes[i], signature);
        }
    }
    
    // Reset functions for testing
    function resetVerification(bytes32 _messageHash) external {
        verifiedMessages[_messageHash] = false;
        verificationTimestamps[_messageHash] = 0;
        messageSignatures[_messageHash] = bytes32(0);
    }
    
    function resetAllVerifications() external {
        verificationCount = 0;
        // Note: Individual mappings need to be reset per message in actual usage
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