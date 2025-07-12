// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILookCoin {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

/**
 * @title IBCModule
 * @dev IBC bridge module for LookCoin BSC-to-Akashic transfers using lock-and-mint mechanism
 */
contract IBCModule is 
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // IBC Configuration
    struct IBCConfig {
        string channelId;
        string portId;
        uint64 timeoutHeight;
        uint64 timeoutTimestamp;
        uint256 minValidators;
        uint256 unbondingPeriod;
    }
    
    IBCConfig public ibcConfig;
    
    // State variables
    ILookCoin public lookCoin;
    address public vaultAddress;
    mapping(bytes32 => bool) public processedPackets;
    mapping(address => uint256) public lockedBalances;
    
    // Validator set
    address[] public validators;
    mapping(address => bool) public isValidator;
    uint256 public validatorThreshold;
    
    // Rate limiting
    uint256 public dailyLimit;
    uint256 public currentDayStart;
    uint256 public currentDayTransferred;
    
    // Packet structure
    struct IBCPacket {
        uint64 sequence;
        string sourcePort;
        string sourceChannel;
        string destinationPort;
        string destinationChannel;
        bytes data;
        uint64 timeoutHeight;
        uint64 timeoutTimestamp;
    }
    
    // Events
    event IBCTransferInitiated(
        address indexed sender,
        string recipient,
        uint256 amount,
        uint64 sequence
    );
    event IBCPacketReceived(
        bytes32 indexed packetId,
        address indexed recipient,
        uint256 amount
    );
    event ValidatorSetUpdated(address[] validators, uint256 threshold);
    event VaultAddressUpdated(address indexed oldVault, address indexed newVault);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    /**
     * @dev Initialize the IBC module
     * @param _lookCoin LookCoin contract address
     * @param _vaultAddress Vault address for locked tokens
     * @param _admin Admin address
     */
    function initialize(
        address _lookCoin,
        address _vaultAddress,
        address _admin
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        
        lookCoin = ILookCoin(_lookCoin);
        vaultAddress = _vaultAddress;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        
        // Initialize IBC config
        ibcConfig = IBCConfig({
            channelId: "channel-0",
            portId: "transfer",
            timeoutHeight: 0,
            timeoutTimestamp: 3600, // 1 hour
            minValidators: 21,
            unbondingPeriod: 14 days
        });
        
        // Initialize rate limit
        dailyLimit = 1000000 * 10**lookCoin.decimals();
        currentDayStart = block.timestamp / 1 days * 1 days;
        
        validatorThreshold = 14; // 2/3 of 21 validators
    }

    /**
     * @dev Lock LOOK tokens for IBC transfer to Akashic chain
     * @param _recipient Recipient address on Akashic chain (bech32 format)
     * @param _amount Amount to transfer
     */
    function lockForIBC(
        string calldata _recipient,
        uint256 _amount
    ) external whenNotPaused nonReentrant {
        require(bytes(_recipient).length > 0, "IBC: invalid recipient");
        require(_amount > 0, "IBC: invalid amount");
        require(validators.length >= ibcConfig.minValidators, "IBC: insufficient validators");
        
        _checkDailyLimit(_amount);
        
        // Transfer tokens to vault
        IERC20(address(lookCoin)).safeTransferFrom(msg.sender, vaultAddress, _amount);
        lockedBalances[msg.sender] += _amount;
        
        // Create IBC packet
        uint64 sequence = uint64(block.timestamp);
        bytes memory packetData = abi.encode(msg.sender, _recipient, _amount);
        
        emit IBCTransferInitiated(msg.sender, _recipient, _amount, sequence);
    }

    /**
     * @dev Handle incoming IBC packet from Akashic chain
     * @param _packet IBC packet data
     * @param _proof Consensus proof from validators
     * @param _signatures Validator signatures
     */
    function handleIBCPacket(
        IBCPacket calldata _packet,
        bytes calldata _proof,
        bytes[] calldata _signatures
    ) external onlyRole(RELAYER_ROLE) whenNotPaused nonReentrant {
        bytes32 packetId = keccak256(abi.encode(_packet));
        require(!processedPackets[packetId], "IBC: packet already processed");
        
        // Verify validator signatures
        require(_verifyValidatorSignatures(packetId, _signatures), "IBC: invalid signatures");
        
        // Decode packet data
        (address originalSender, address recipient, uint256 amount) = abi.decode(
            _packet.data,
            (address, address, uint256)
        );
        
        // Check timeout
        require(
            block.timestamp <= _packet.timeoutTimestamp || _packet.timeoutTimestamp == 0,
            "IBC: packet timeout"
        );
        
        processedPackets[packetId] = true;
        
        // Mint tokens to recipient
        lookCoin.mint(recipient, amount);
        
        emit IBCPacketReceived(packetId, recipient, amount);
    }

    /**
     * @dev Create IBC packet for relayer
     * @param _sender Original sender
     * @param _recipient Recipient on Akashic
     * @param _amount Amount
     * @return packet Encoded packet data
     */
    function createIBCPacket(
        address _sender,
        string calldata _recipient,
        uint256 _amount
    ) external view returns (bytes memory packet) {
        IBCPacket memory ibcPacket = IBCPacket({
            sequence: uint64(block.timestamp),
            sourcePort: ibcConfig.portId,
            sourceChannel: ibcConfig.channelId,
            destinationPort: "transfer",
            destinationChannel: "channel-0",
            data: abi.encode(_sender, _recipient, _amount),
            timeoutHeight: ibcConfig.timeoutHeight,
            timeoutTimestamp: uint64(block.timestamp + ibcConfig.timeoutTimestamp)
        });
        
        return abi.encode(ibcPacket);
    }

    /**
     * @dev Update validator set
     * @param _validators New validator addresses
     * @param _threshold New threshold
     */
    function updateValidatorSet(
        address[] calldata _validators,
        uint256 _threshold
    ) external onlyRole(ADMIN_ROLE) {
        require(_validators.length >= ibcConfig.minValidators, "IBC: insufficient validators");
        require(_threshold <= _validators.length, "IBC: invalid threshold");
        require(_threshold >= (_validators.length * 2) / 3, "IBC: threshold too low");
        
        // Clear old validators
        for (uint i = 0; i < validators.length; i++) {
            isValidator[validators[i]] = false;
        }
        
        // Set new validators
        validators = _validators;
        for (uint i = 0; i < _validators.length; i++) {
            isValidator[_validators[i]] = true;
        }
        
        validatorThreshold = _threshold;
        emit ValidatorSetUpdated(_validators, _threshold);
    }

    /**
     * @dev Update IBC configuration
     * @param _config New IBC configuration
     */
    function updateIBCConfig(IBCConfig calldata _config) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        ibcConfig = _config;
    }

    /**
     * @dev Update vault address
     * @param _newVault New vault address
     */
    function updateVaultAddress(address _newVault) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(_newVault != address(0), "IBC: invalid vault");
        address oldVault = vaultAddress;
        vaultAddress = _newVault;
        emit VaultAddressUpdated(oldVault, _newVault);
    }

    /**
     * @dev Update daily transfer limit
     * @param _limit New daily limit
     */
    function updateDailyLimit(uint256 _limit) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        dailyLimit = _limit;
    }

    /**
     * @dev Emergency withdraw tokens
     * @param _token Token address
     * @param _to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(ADMIN_ROLE) {
        require(_to != address(0), "IBC: invalid recipient");
        
        if (_token == address(0)) {
            payable(_to).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
        
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /**
     * @dev Pause the contract
     */
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Check daily transfer limit
     * @param _amount Transfer amount
     */
    function _checkDailyLimit(uint256 _amount) internal {
        uint256 currentDay = block.timestamp / 1 days * 1 days;
        
        if (currentDay > currentDayStart) {
            currentDayStart = currentDay;
            currentDayTransferred = 0;
        }
        
        require(
            currentDayTransferred + _amount <= dailyLimit,
            "IBC: daily limit exceeded"
        );
        
        currentDayTransferred += _amount;
    }

    /**
     * @dev Verify validator signatures
     * @param _packetId Packet ID
     * @param _signatures Validator signatures
     * @return valid Whether signatures are valid
     */
    function _verifyValidatorSignatures(
        bytes32 _packetId,
        bytes[] calldata _signatures
    ) internal view returns (bool) {
        require(_signatures.length >= validatorThreshold, "IBC: insufficient signatures");
        
        uint256 validSignatures = 0;
        address[] memory signers = new address[](_signatures.length);
        
        for (uint i = 0; i < _signatures.length; i++) {
            address signer = _recoverSigner(_packetId, _signatures[i]);
            
            // Check if signer is a validator and not duplicate
            if (isValidator[signer]) {
                bool isDuplicate = false;
                for (uint j = 0; j < i; j++) {
                    if (signers[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                
                if (!isDuplicate) {
                    signers[i] = signer;
                    validSignatures++;
                }
            }
        }
        
        return validSignatures >= validatorThreshold;
    }

    /**
     * @dev Recover signer from signature
     * @param _message Message hash
     * @param _signature Signature
     * @return signer Signer address
     */
    function _recoverSigner(
        bytes32 _message,
        bytes calldata _signature
    ) internal pure returns (address) {
        require(_signature.length == 65, "IBC: invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := calldataload(add(_signature.offset, 0))
            s := calldataload(add(_signature.offset, 32))
            v := byte(0, calldataload(add(_signature.offset, 64)))
        }
        
        if (v < 27) v += 27;
        
        return ecrecover(_message, v, r, s);
    }
}