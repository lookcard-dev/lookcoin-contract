// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// RateLimiter import removed for now

interface ILookCoin {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

/**
 * @title IBCModule [DEPRECATED]
 * @dev DEPRECATED: This module is being replaced by HyperlaneModule for improved Akashic chain integration
 * @notice Legacy IBC bridge module - new transfers should use HyperlaneModule instead
 * @dev Existing transfers will be honored but no new transfers are accepted
 * @custom:deprecated Use HyperlaneModule for BSC-Akashic transfers
 */
contract IBCModule is 
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // IBC Configuration
    /// @dev Configuration structure for IBC protocol parameters
    struct IBCConfig {
        string channelId;
        string portId;
        uint64 timeoutHeight;
        uint64 timeoutTimestamp;
        uint256 minValidators;
        uint256 unbondingPeriod;
    }
    
    /// @dev Current IBC protocol configuration
    IBCConfig public ibcConfig;
    
    // State variables
    /// @dev LookCoin contract interface for minting tokens
    ILookCoin public lookCoin;
    /// @dev Vault address where locked tokens are stored
    address public vaultAddress;
    /// @dev Mapping to track processed IBC packets to prevent replay attacks
    mapping(bytes32 => bool) public processedPackets;
    /// @dev Mapping of user addresses to their locked token balances
    mapping(address => uint256) public lockedBalances;
    
    // Deprecation state
    /// @dev Flag indicating if the module is deprecated
    bool public isDeprecated;
    /// @dev Timestamp when deprecation was activated
    uint256 public deprecationTimestamp;
    /// @dev Address of the replacement module (HyperlaneModule)
    address public replacementModule;
    
    // Validator set
    /// @dev Array of active validator addresses
    address[] public validators;
    /// @dev Mapping to check if an address is an active validator
    mapping(address => bool) public isValidator;
    /// @dev Required number of validator signatures for packet verification
    uint256 public validatorThreshold;
    
    // Packet structure
    /// @dev IBC packet structure for cross-chain communication
    struct IBCPacket {
        uint64 sequence;              // Unique packet sequence number
        string sourcePort;            // Source port identifier
        string sourceChannel;         // Source channel identifier
        string destinationPort;       // Destination port identifier
        string destinationChannel;    // Destination channel identifier
        bytes data;                   // Encoded transfer data
        uint64 timeoutHeight;         // Block height timeout (0 for disabled)
        uint64 timeoutTimestamp;      // Timestamp timeout in seconds
    }
    
    // Events
    /// @notice Emitted when tokens are locked for IBC transfer
    /// @param sender Address that initiated the transfer
    /// @param recipient Recipient address on Akashic chain (bech32 format)
    /// @param amount Amount of tokens locked
    /// @param sequence Unique sequence number for the transfer
    event IBCTransferInitiated(
        address indexed sender,
        string recipient,
        uint256 amount,
        uint64 sequence
    );
    
    /// @notice Emitted when an IBC packet is received and processed
    /// @param packetId Unique identifier of the processed packet
    /// @param recipient Address receiving the minted tokens
    /// @param amount Amount of tokens minted
    event IBCPacketReceived(
        bytes32 indexed packetId,
        address indexed recipient,
        uint256 amount
    );
    
    /// @notice Emitted when the validator set is updated
    /// @param validators Array of new validator addresses
    /// @param threshold New threshold for signature validation
    event ValidatorSetUpdated(address[] validators, uint256 threshold);
    
    /// @notice Emitted when the vault address is changed
    /// @param oldVault Previous vault address
    /// @param newVault New vault address
    event VaultAddressUpdated(address indexed oldVault, address indexed newVault);
    
    /// @notice Emitted when emergency withdrawal is performed
    /// @param token Token address (address(0) for native token)
    /// @param to Recipient address
    /// @param amount Amount withdrawn
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);
    
    /// @notice Emitted when the module is deprecated
    /// @param timestamp Timestamp when deprecation was activated
    /// @param replacementModule Address of the replacement module
    event ModuleDeprecated(uint256 timestamp, address replacementModule);

    /**
     * @dev Initialize the IBC module
     * @param _lookCoin LookCoin contract address for token operations
     * @param _vaultAddress Vault address where locked tokens will be stored
     * @param _admin Admin address to be granted all administrative roles
     * @notice Sets up the bridge with default IBC configuration
     * @dev Default config: channel-0, 1-hour timeout, 21 validators, 14-day unbonding
     */
    function initialize(
        address _lookCoin,
        address _vaultAddress,
        address _admin
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        // RateLimiter initialization removed
        
        lookCoin = ILookCoin(_lookCoin);
        vaultAddress = _vaultAddress;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        // Rate limit admin role removed
        
        // Initialize IBC config
        ibcConfig = IBCConfig({
            channelId: "channel-0",
            portId: "transfer",
            timeoutHeight: 0,
            timeoutTimestamp: 3600, // 1 hour
            minValidators: 21,
            unbondingPeriod: 14 days
        });
        
        // Rate limit configuration removed for now
        
        validatorThreshold = 14; // 2/3 of 21 validators
    }

    /**
     * @dev Lock LOOK tokens for IBC transfer to Akashic chain
     * @param _recipient Recipient address on Akashic chain (bech32 format)
     * @param _amount Amount to transfer
     * @notice Locks tokens in vault and emits event for relayers to process
     * @dev Requires minimum validators to be active for security
     */
    function lockForIBC(
        string calldata _recipient,
        uint256 _amount
    ) external 
        whenNotPaused 
        nonReentrant
        // Rate limiting check removed
    {
        require(!isDeprecated, "IBC: module deprecated - use HyperlaneModule");
        require(bytes(_recipient).length > 0, "IBC: invalid recipient");
        require(_amount > 0, "IBC: invalid amount");
        require(validators.length >= ibcConfig.minValidators, "IBC: insufficient validators");
        
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
     * @param _packet IBC packet data containing transfer information
     * @param _proof Consensus proof from validators (currently unused)
     * @param _signatures Array of validator signatures for packet verification
     * @notice Processes cross-chain transfer and mints tokens to recipient
     * @dev Requires threshold validator signatures and validates timeouts
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
        
        // Rate limiting check removed for incoming transfers
        
        // Mint tokens to recipient
        lookCoin.mint(recipient, amount);
        
        emit IBCPacketReceived(packetId, recipient, amount);
    }

    /**
     * @dev Create IBC packet for relayer
     * @param _sender Original sender address on BSC
     * @param _recipient Recipient address on Akashic (bech32 format)
     * @param _amount Amount of tokens to transfer
     * @return packet Encoded IBC packet data for relayer submission
     * @notice Helper function for relayers to construct valid IBC packets
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
     * @param _validators Array of new validator addresses
     * @param _threshold New threshold for signature validation
     * @notice Updates the validator set for packet verification
     * @dev Threshold must be at least 2/3 of total validators
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
     * @param _config New IBC configuration parameters
     * @notice Updates channel, port, timeout, and validator requirements
     * @dev Critical operation that affects all IBC functionality
     */
    function updateIBCConfig(IBCConfig calldata _config) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        ibcConfig = _config;
    }

    /**
     * @dev Update vault address
     * @param _newVault New vault address for locked tokens
     * @notice Changes where locked tokens are stored
     * @dev Ensure proper token migration before updating
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
     * @dev Emergency withdraw tokens
     * @param _token Token address (use address(0) for native token)
     * @param _to Recipient address
     * @param _amount Amount to withdraw
     * @notice Allows admin to recover stuck tokens or ETH
     * @dev Should only be used in emergency situations
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
     * @notice Pauses all IBC operations including locks and packet processing
     * @dev Only OPERATOR_ROLE can pause
     */
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     * @notice Resumes normal IBC operations
     * @dev Only OPERATOR_ROLE can unpause
     */
    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Verify validator signatures
     * @param _packetId Packet ID to verify signatures against
     * @param _signatures Array of validator signatures
     * @return valid Whether threshold signatures are valid
     * @notice Validates signatures from registered validators
     * @dev Prevents duplicate signatures and requires threshold to be met
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
     * @param _message Message hash that was signed
     * @param _signature 65-byte signature (r, s, v)
     * @return signer Address that created the signature
     * @notice Uses ecrecover to extract signer address
     * @dev Handles v normalization for compatibility
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

    /**
     * @dev Override supportsInterface for multiple inheritance
     * @notice Required for AccessControl compatibility
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Deprecate this module and set replacement
     * @param _replacementModule Address of the replacement module (HyperlaneModule)
     * @notice Marks module as deprecated and prevents new transfers
     * @dev Can only be called once by admin
     */
    function deprecateModule(address _replacementModule) external onlyRole(ADMIN_ROLE) {
        require(!isDeprecated, "IBC: already deprecated");
        require(_replacementModule != address(0), "IBC: invalid replacement");
        
        isDeprecated = true;
        deprecationTimestamp = block.timestamp;
        replacementModule = _replacementModule;
        
        emit ModuleDeprecated(block.timestamp, _replacementModule);
    }
    
    /**
     * @dev Emergency migration function to move locked balances
     * @param users Array of user addresses to migrate
     * @param amounts Array of corresponding locked amounts
     * @param destination Address to transfer funds to (usually HyperlaneModule)
     * @notice Allows migration of locked funds to new module
     * @dev Only callable by admin after deprecation
     */
    function migrateLockedBalances(
        address[] calldata users,
        uint256[] calldata amounts,
        address destination
    ) external onlyRole(ADMIN_ROLE) {
        require(isDeprecated, "IBC: not deprecated");
        require(users.length == amounts.length, "IBC: array mismatch");
        require(destination != address(0), "IBC: invalid destination");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < users.length; i++) {
            require(lockedBalances[users[i]] >= amounts[i], "IBC: insufficient balance");
            lockedBalances[users[i]] -= amounts[i];
            totalAmount += amounts[i];
        }
        
        if (totalAmount > 0) {
            IERC20(address(lookCoin)).safeTransfer(destination, totalAmount);
        }
    }

    /**
     * @dev Authorize upgrade for UUPS proxy
     * @param newImplementation New implementation address
     * @notice Restricts upgrades to ADMIN_ROLE only
     * @dev Critical security function for upgrade control
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(ADMIN_ROLE)
    {}
}