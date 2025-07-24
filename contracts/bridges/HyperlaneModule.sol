// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IInterchainGasPaymaster.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMessageRecipient.sol";
import "../interfaces/ILookBridgeModule.sol";
import "../interfaces/ILookCoin.sol";

/**
 * @title HyperlaneModule
 * @dev Hyperlane module for Akashic-BSC bridge
 */
contract HyperlaneModule is
  AccessControlUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  UUPSUpgradeable,
  ILookBridgeModule,
  IMessageRecipient
{
  bytes32 public constant BRIDGE_ADMIN_ROLE = keccak256("BRIDGE_ADMIN_ROLE");
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
  bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

  ILookCoin public lookCoin;
  IMailbox public mailbox;
  IInterchainGasPaymaster public gasPaymaster;

  mapping(bytes32 => BridgeTransfer) public transfers;
  mapping(uint32 => uint256) public domainToChainId; // Hyperlane domain to standard chain ID
  mapping(uint256 => uint32) public chainIdToDomain; // Standard chain ID to Hyperlane domain
  mapping(uint32 => bytes32) public trustedSenders; // Trusted sender per domain

  // ISM (Interchain Security Module) configuration
  address public interchainSecurityModule;
  uint256 public requiredGasAmount;

  uint256[50] private __gap;

  event DomainMappingUpdated(uint32 domain, uint256 chainId);
  event TrustedSenderUpdated(uint32 domain, bytes32 sender);
  event ISMUpdated(address indexed ism);
  event GasAmountUpdated(uint256 amount);

  function initialize(address _lookCoin, address _mailbox, address _gasPaymaster, address _admin) public initializer {
    __AccessControl_init();
    __Pausable_init();
    __ReentrancyGuard_init();
    __UUPSUpgradeable_init();

    lookCoin = ILookCoin(_lookCoin);
    mailbox = IMailbox(_mailbox);
    gasPaymaster = IInterchainGasPaymaster(_gasPaymaster);

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(BRIDGE_ADMIN_ROLE, _admin);
    _grantRole(OPERATOR_ROLE, _admin);

    // Initialize default gas amount
    requiredGasAmount = 200000;

    // Note: Domain mappings are now configured via setDomainMapping() after deployment
    // This allows for flexible chain support without hardcoded values
  }

  function bridgeToken(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
  ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
    require(amount > 0, "HyperlaneModule: invalid amount");
    require(recipient != address(0), "HyperlaneModule: invalid recipient");

    uint32 destinationDomain = chainIdToDomain[destinationChain];
    require(destinationDomain != 0, "HyperlaneModule: unsupported chain");
    require(trustedSenders[destinationDomain] != bytes32(0), "HyperlaneModule: untrusted destination");

    // Burn tokens from sender
    lookCoin.burn(msg.sender, amount);

    // Generate transfer ID
    transferId = keccak256(abi.encodePacked(msg.sender, recipient, amount, block.timestamp));

    // Store transfer info
    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: msg.sender,
      recipient: recipient,
      amount: amount,
      sourceChain: block.chainid,
      destinationChain: destinationChain,
      protocol: "Hyperlane",
      status: TransferStatus.Pending,
      timestamp: block.timestamp
    });

    // Encode message
    bytes memory message = abi.encode(recipient, amount, transferId);

    // Dispatch message via Hyperlane
    bytes32 messageId = mailbox.dispatch(
      destinationDomain,
      _addressToBytes32(address(this)), // Recipient is this contract on destination
      message
    );

    // Pay for gas if value sent
    if (msg.value > 0) {
      gasPaymaster.payForGas{value: msg.value}(messageId, destinationDomain, requiredGasAmount, msg.sender);
    }

    emit TransferInitiated(transferId, msg.sender, destinationChain, amount, "Hyperlane");
  }

  function handle(uint32 _origin, bytes32 _sender, bytes calldata _message) external payable override {
    require(msg.sender == address(mailbox), "HyperlaneModule: unauthorized mailbox");
    require(trustedSenders[_origin] == _sender, "HyperlaneModule: untrusted sender");

    // Decode message
    (address recipient, uint256 amount, bytes32 originalTransferId) = abi.decode(_message, (address, uint256, bytes32));

    // Mint tokens to recipient
    lookCoin.mint(recipient, amount);

    // Create incoming transfer record
    bytes32 transferId = keccak256(abi.encodePacked(_origin, recipient, amount, block.timestamp));

    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: _bytes32ToAddress(_sender),
      recipient: recipient,
      amount: amount,
      sourceChain: domainToChainId[_origin],
      destinationChain: block.chainid,
      protocol: "Hyperlane",
      status: TransferStatus.Completed,
      timestamp: block.timestamp
    });

    emit TransferCompleted(transferId, recipient, amount);
  }

  function handleIncoming(
    uint256 sourceChain,
    address sender,
    address recipient,
    uint256 amount,
    bytes calldata data
  ) external override onlyRole(OPERATOR_ROLE) {
    // This is called by operators for manual processing if needed
    lookCoin.mint(recipient, amount);

    bytes32 transferId = keccak256(abi.encodePacked(sender, recipient, amount, block.timestamp));

    transfers[transferId] = BridgeTransfer({
      id: transferId,
      sender: sender,
      recipient: recipient,
      amount: amount,
      sourceChain: sourceChain,
      destinationChain: block.chainid,
      protocol: "Hyperlane",
      status: TransferStatus.Completed,
      timestamp: block.timestamp
    });

    emit TransferCompleted(transferId, recipient, amount);
  }

  function setDomainMapping(uint32 domain, uint256 chainId) external onlyRole(BRIDGE_ADMIN_ROLE) {
    domainToChainId[domain] = chainId;
    chainIdToDomain[chainId] = domain;
    emit DomainMappingUpdated(domain, chainId);
  }

  function setTrustedSender(uint32 domain, address sender) external onlyRole(BRIDGE_ADMIN_ROLE) {
    trustedSenders[domain] = _addressToBytes32(sender);
    emit TrustedSenderUpdated(domain, _addressToBytes32(sender));
  }

  function setInterchainSecurityModule(address _ism) external onlyRole(BRIDGE_ADMIN_ROLE) {
    interchainSecurityModule = _ism;
    emit ISMUpdated(_ism);
  }

  function setRequiredGasAmount(uint256 _amount) external onlyRole(BRIDGE_ADMIN_ROLE) {
    requiredGasAmount = _amount;
    emit GasAmountUpdated(_amount);
  }

  function estimateFee(
    uint256 destinationChain,
    uint256 amount,
    bytes calldata params
  ) external view override returns (uint256 fee, uint256 estimatedTime) {
    uint32 destinationDomain = chainIdToDomain[destinationChain];
    require(destinationDomain != 0, "HyperlaneModule: unsupported chain");

    // Estimate gas cost
    fee = gasPaymaster.quoteGasPayment(destinationDomain, requiredGasAmount);

    // Hyperlane transfers typically take 2-3 minutes
    estimatedTime = 150;
  }

  function getStatus(bytes32 transferId) external view override returns (TransferStatus) {
    return transfers[transferId].status;
  }

  function updateConfig(bytes calldata config) external override onlyRole(BRIDGE_ADMIN_ROLE) {
    // Decode and apply configuration updates
    (uint256 gasAmount, address ism, uint32 domain, address trustedSender) = abi.decode(
      config,
      (uint256, address, uint32, address)
    );

    if (gasAmount > 0) {
      requiredGasAmount = gasAmount;
    }
    if (ism != address(0)) {
      interchainSecurityModule = ism;
    }
    if (domain > 0 && trustedSender != address(0)) {
      trustedSenders[domain] = _addressToBytes32(trustedSender);
    }
  }

  function emergencyWithdraw(address token, address to, uint256 amount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
    if (token == address(0)) {
      payable(to).transfer(amount);
    } else {
      IERC20(token).transfer(to, amount);
    }
  }

  function pause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
    _pause();
    emit ProtocolStatusChanged(ProtocolStatus.Paused);
  }

  function unpause() external override onlyRole(BRIDGE_ADMIN_ROLE) {
    _unpause();
    emit ProtocolStatusChanged(ProtocolStatus.Active);
  }

  function _addressToBytes32(address addr) private pure returns (bytes32) {
    return bytes32(uint256(uint160(addr)));
  }

  function _bytes32ToAddress(bytes32 addr) private pure returns (address) {
    return address(uint160(uint256(addr)));
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
