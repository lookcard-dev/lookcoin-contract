// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockIBCRelayer
 * @dev Mock IBC relayer for testing packet handling
 */
contract MockIBCRelayer {
    struct Packet {
        uint64 sequence;
        string sourcePort;
        string sourceChannel;
        string destinationPort;
        string destinationChannel;
        bytes data;
        uint64 timeoutHeight;
        uint64 timeoutTimestamp;
    }
    
    struct PacketCommitment {
        bytes32 commitment;
        uint256 timestamp;
        bool acknowledged;
        bool timedOut;
    }
    
    mapping(bytes32 => Packet) public packets;
    mapping(bytes32 => PacketCommitment) public commitments;
    mapping(string => mapping(string => uint64)) public nextSequence; // port => channel => sequence
    
    uint64 public currentHeight = 1000;
    uint256 public packetTimeout = 3600; // 1 hour default
    
    event PacketSent(
        bytes32 indexed packetId,
        uint64 sequence,
        string sourcePort,
        string sourceChannel,
        string destinationPort,
        string destinationChannel
    );
    
    event PacketReceived(bytes32 indexed packetId, bool success);
    event PacketAcknowledged(bytes32 indexed packetId);
    event PacketTimedOut(bytes32 indexed packetId);
    
    /**
     * @dev Send IBC packet
     */
    function sendPacket(
        string calldata _sourcePort,
        string calldata _sourceChannel,
        string calldata _destinationPort,
        string calldata _destinationChannel,
        bytes calldata _data
    ) external returns (bytes32 packetId, uint64 sequence) {
        sequence = nextSequence[_sourcePort][_sourceChannel]++;
        
        Packet memory packet = Packet({
            sequence: sequence,
            sourcePort: _sourcePort,
            sourceChannel: _sourceChannel,
            destinationPort: _destinationPort,
            destinationChannel: _destinationChannel,
            data: _data,
            timeoutHeight: 0, // Not using height timeout
            timeoutTimestamp: uint64(block.timestamp + packetTimeout)
        });
        
        packetId = keccak256(abi.encode(packet));
        packets[packetId] = packet;
        
        commitments[packetId] = PacketCommitment({
            commitment: keccak256(_data),
            timestamp: block.timestamp,
            acknowledged: false,
            timedOut: false
        });
        
        emit PacketSent(
            packetId,
            sequence,
            _sourcePort,
            _sourceChannel,
            _destinationPort,
            _destinationChannel
        );
    }
    
    /**
     * @dev Receive IBC packet
     */
    function receivePacket(bytes32 _packetId) external returns (bool success) {
        Packet memory packet = packets[_packetId];
        require(packet.sequence > 0, "MockIBCRelayer: packet not found");
        
        PacketCommitment storage commitment = commitments[_packetId];
        require(!commitment.acknowledged, "MockIBCRelayer: already acknowledged");
        require(!commitment.timedOut, "MockIBCRelayer: already timed out");
        
        // Check timeout
        if (block.timestamp > packet.timeoutTimestamp) {
            commitment.timedOut = true;
            emit PacketTimedOut(_packetId);
            return false;
        }
        
        // Simulate packet delivery
        success = true; // In real implementation, would call destination contract
        
        emit PacketReceived(_packetId, success);
        return success;
    }
    
    /**
     * @dev Acknowledge packet
     */
    function acknowledgePacket(bytes32 _packetId, bytes calldata _acknowledgement) external {
        PacketCommitment storage commitment = commitments[_packetId];
        require(commitment.commitment != bytes32(0), "MockIBCRelayer: packet not found");
        require(!commitment.acknowledged, "MockIBCRelayer: already acknowledged");
        require(!commitment.timedOut, "MockIBCRelayer: packet timed out");
        
        commitment.acknowledged = true;
        
        emit PacketAcknowledged(_packetId);
    }
    
    /**
     * @dev Timeout packet
     */
    function timeoutPacket(bytes32 _packetId) external {
        Packet memory packet = packets[_packetId];
        require(packet.sequence > 0, "MockIBCRelayer: packet not found");
        
        PacketCommitment storage commitment = commitments[_packetId];
        require(!commitment.acknowledged, "MockIBCRelayer: already acknowledged");
        require(block.timestamp > packet.timeoutTimestamp, "MockIBCRelayer: not timed out");
        
        commitment.timedOut = true;
        
        emit PacketTimedOut(_packetId);
    }
    
    /**
     * @dev Set packet timeout
     */
    function setPacketTimeout(uint256 _timeout) external {
        packetTimeout = _timeout;
    }
    
    /**
     * @dev Increment height (for testing timeout by height)
     */
    function incrementHeight(uint64 _blocks) external {
        currentHeight += _blocks;
    }
}

/**
 * @title MockAkashicValidators
 * @dev Mock Akashic chain validators for consensus simulation
 */
contract MockAkashicValidators {
    struct Validator {
        address addr;
        uint256 votingPower;
        bool active;
        uint256 unbondingTime;
    }
    
    mapping(address => Validator) public validators;
    address[] public validatorList;
    uint256 public totalVotingPower;
    
    uint256 public constant MIN_VALIDATORS = 21;
    uint256 public constant UNBONDING_PERIOD = 14 days;
    uint256 public constant CONSENSUS_THRESHOLD = 67; // 67% in percentage
    
    mapping(bytes32 => mapping(address => bool)) public votes;
    mapping(bytes32 => uint256) public proposalVotingPower;
    
    event ValidatorAdded(address indexed validator, uint256 votingPower);
    event ValidatorRemoved(address indexed validator);
    event ValidatorSlashed(address indexed validator, uint256 slashAmount);
    event ConsensusReached(bytes32 indexed proposalId);
    
    constructor() {
        // Initialize with minimum validators for testing
        for (uint i = 0; i < MIN_VALIDATORS; i++) {
            address validator = address(uint160(0x1000 + i));
            _addValidator(validator, 100); // Equal voting power
        }
    }
    
    /**
     * @dev Add validator
     */
    function addValidator(address _validator, uint256 _votingPower) external {
        require(validators[_validator].addr == address(0), "MockAkashic: already validator");
        _addValidator(_validator, _votingPower);
    }
    
    function _addValidator(address _validator, uint256 _votingPower) internal {
        validators[_validator] = Validator({
            addr: _validator,
            votingPower: _votingPower,
            active: true,
            unbondingTime: 0
        });
        
        validatorList.push(_validator);
        totalVotingPower += _votingPower;
        
        emit ValidatorAdded(_validator, _votingPower);
    }
    
    /**
     * @dev Remove validator (with unbonding period)
     */
    function removeValidator(address _validator) external {
        Validator storage val = validators[_validator];
        require(val.addr != address(0), "MockAkashic: not validator");
        require(val.active, "MockAkashic: already unbonding");
        require(validatorList.length > MIN_VALIDATORS, "MockAkashic: minimum validators required");
        
        val.active = false;
        val.unbondingTime = block.timestamp + UNBONDING_PERIOD;
        totalVotingPower -= val.votingPower;
        
        emit ValidatorRemoved(_validator);
    }
    
    /**
     * @dev Slash validator
     */
    function slashValidator(address _validator, uint256 _slashPercentage) external {
        Validator storage val = validators[_validator];
        require(val.addr != address(0), "MockAkashic: not validator");
        require(_slashPercentage <= 100, "MockAkashic: invalid slash percentage");
        
        uint256 slashAmount = (val.votingPower * _slashPercentage) / 100;
        val.votingPower -= slashAmount;
        
        if (val.active) {
            totalVotingPower -= slashAmount;
        }
        
        emit ValidatorSlashed(_validator, slashAmount);
    }
    
    /**
     * @dev Vote on proposal
     */
    function vote(bytes32 _proposalId) external {
        Validator memory val = validators[msg.sender];
        require(val.addr != address(0) && val.active, "MockAkashic: not active validator");
        require(!votes[_proposalId][msg.sender], "MockAkashic: already voted");
        
        votes[_proposalId][msg.sender] = true;
        proposalVotingPower[_proposalId] += val.votingPower;
        
        // Check if consensus reached
        if ((proposalVotingPower[_proposalId] * 100) / totalVotingPower >= CONSENSUS_THRESHOLD) {
            emit ConsensusReached(_proposalId);
        }
    }
    
    /**
     * @dev Check if proposal has consensus
     */
    function hasConsensus(bytes32 _proposalId) external view returns (bool) {
        return (proposalVotingPower[_proposalId] * 100) / totalVotingPower >= CONSENSUS_THRESHOLD;
    }
    
    /**
     * @dev Get active validator count
     */
    function getActiveValidatorCount() external view returns (uint256 count) {
        for (uint i = 0; i < validatorList.length; i++) {
            if (validators[validatorList[i]].active) {
                count++;
            }
        }
    }
    
    /**
     * @dev Complete unbonding
     */
    function completeUnbonding(address _validator) external {
        Validator storage val = validators[_validator];
        require(val.addr != address(0), "MockAkashic: not validator");
        require(!val.active, "MockAkashic: still active");
        require(block.timestamp >= val.unbondingTime, "MockAkashic: unbonding period not complete");
        
        // Remove from validator list
        for (uint i = 0; i < validatorList.length; i++) {
            if (validatorList[i] == _validator) {
                validatorList[i] = validatorList[validatorList.length - 1];
                validatorList.pop();
                break;
            }
        }
        
        delete validators[_validator];
    }
}

/**
 * @title MockIBCLightClient
 * @dev Mock IBC light client for consensus proof validation
 */
contract MockIBCLightClient {
    struct Header {
        uint64 height;
        uint256 timestamp;
        bytes32 appHash;
        bytes32 validatorsHash;
    }
    
    struct ConsensusProof {
        Header header;
        bytes signatures;
        bool valid;
    }
    
    mapping(uint64 => Header) public headers;
    mapping(bytes32 => ConsensusProof) public proofs;
    
    uint64 public latestHeight;
    uint256 public trustPeriod = 14 days;
    
    event HeaderUpdated(uint64 indexed height, bytes32 appHash);
    event ProofValidated(bytes32 indexed proofId, bool valid);
    
    /**
     * @dev Update header
     */
    function updateHeader(
        uint64 _height,
        bytes32 _appHash,
        bytes32 _validatorsHash
    ) external {
        require(_height > latestHeight, "MockIBCLight: height must increase");
        
        headers[_height] = Header({
            height: _height,
            timestamp: block.timestamp,
            appHash: _appHash,
            validatorsHash: _validatorsHash
        });
        
        latestHeight = _height;
        
        emit HeaderUpdated(_height, _appHash);
    }
    
    /**
     * @dev Validate consensus proof
     */
    function validateProof(
        bytes32 _proofId,
        Header calldata _header,
        bytes calldata _signatures
    ) external returns (bool) {
        // Simplified validation - in reality would verify signatures against validator set
        bool valid = _header.height <= latestHeight && 
                    _signatures.length >= 65; // At least one signature
        
        proofs[_proofId] = ConsensusProof({
            header: _header,
            signatures: _signatures,
            valid: valid
        });
        
        emit ProofValidated(_proofId, valid);
        
        return valid;
    }
    
    /**
     * @dev Check if header is within trust period
     */
    function isWithinTrustPeriod(uint64 _height) external view returns (bool) {
        Header memory header = headers[_height];
        return header.timestamp > 0 && 
               block.timestamp <= header.timestamp + trustPeriod;
    }
    
    /**
     * @dev Get header
     */
    function getHeader(uint64 _height) external view returns (Header memory) {
        return headers[_height];
    }
    
    /**
     * @dev Set trust period
     */
    function setTrustPeriod(uint256 _period) external {
        trustPeriod = _period;
    }
}