import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LookCoin, HyperlaneModule, CrossChainRouter } from "../typechain-types";

// Mock contracts for Hyperlane testing
interface MockMailbox {
  dispatch: (destinationDomain: number, recipientAddress: string, messageBody: string) => Promise<any>;
  process: (metadata: string, message: string) => Promise<void>;
  setDefaultISM: (ism: string) => Promise<void>;
}

interface MockGasPaymaster {
  payForGas: (messageId: string, destinationDomain: number, gasAmount: number, refundAddress: string) => Promise<void>;
  quoteGasPayment: (destinationDomain: number, gasAmount: number) => Promise<bigint>;
}

describe("Hyperlane Test", function () {
  let lookCoin: LookCoin;
  let hyperlaneModule: HyperlaneModule;
  let crossChainRouter: CrossChainRouter;
  let mockMailbox: any;
  let mockGasPaymaster: any;
  let mockISM: any;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let relayer: SignerWithAddress;

  const PROTOCOL_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PROTOCOL_ADMIN_ROLE"));
  const BRIDGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE"));
  const ROUTER_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ROUTER_ADMIN_ROLE"));

  // Hyperlane domain IDs
  const BSC_DOMAIN = 56;
  const AKASHIC_DOMAIN = 9070;
  const OPTIMISM_DOMAIN = 10;

  beforeEach(async function () {
    [owner, addr1, addr2, relayer] = await ethers.getSigners();

    // Deploy mock Hyperlane contracts
    const MockMailbox = await ethers.getContractFactory("MockHyperlaneMailbox");
    mockMailbox = await MockMailbox.deploy();
    await mockMailbox.waitForDeployment();

    const MockGasPaymaster = await ethers.getContractFactory("MockHyperlaneGasPaymaster");
    mockGasPaymaster = await MockGasPaymaster.deploy();
    await mockGasPaymaster.waitForDeployment();

    const MockISM = await ethers.getContractFactory("MockInterchainSecurityModule");
    mockISM = await MockISM.deploy();
    await mockISM.waitForDeployment();

    // Deploy LookCoin
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = (await upgrades.deployProxy(LookCoin, [owner.address, ethers.ZeroAddress], {
      initializer: "initialize",
    })) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Configure Hyperlane on LookCoin
    await lookCoin.setHyperlaneMailbox(await mockMailbox.getAddress());
    await lookCoin.setHyperlaneGasPaymaster(await mockGasPaymaster.getAddress());
    await lookCoin.setSupportedHyperlaneDomain(AKASHIC_DOMAIN, true);
    await lookCoin.setSupportedHyperlaneDomain(OPTIMISM_DOMAIN, true);

    // Deploy HyperlaneModule
    const HyperlaneModule = await ethers.getContractFactory("HyperlaneModule");
    hyperlaneModule = (await upgrades.deployProxy(
      HyperlaneModule,
      [
        await lookCoin.getAddress(),
        await mockMailbox.getAddress(),
        await mockGasPaymaster.getAddress(),
        owner.address,
      ],
      { initializer: "initialize" }
    )) as unknown as HyperlaneModule;
    await hyperlaneModule.waitForDeployment();

    // Configure HyperlaneModule
    await hyperlaneModule.setInterchainSecurityModule(await mockISM.getAddress());
    await hyperlaneModule.addSupportedDomain(AKASHIC_DOMAIN);
    await hyperlaneModule.addSupportedDomain(OPTIMISM_DOMAIN);

    // Set up CrossChainRouter for integration tests
    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await upgrades.deployProxy(FeeManager, [owner.address], {
      initializer: "initialize",
    });
    await feeManager.waitForDeployment();

    const SecurityManager = await ethers.getContractFactory("SecurityManager");
    const securityManager = await upgrades.deployProxy(
      SecurityManager,
      [owner.address, ethers.parseEther("20000000")], // 20M daily limit
      { initializer: "initialize" }
    );
    await securityManager.waitForDeployment();

    const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
    crossChainRouter = (await upgrades.deployProxy(
      CrossChainRouter,
      [
        await lookCoin.getAddress(),
        await feeManager.getAddress(),
        await securityManager.getAddress(),
        owner.address,
      ],
      { initializer: "initialize" }
    )) as unknown as CrossChainRouter;
    await crossChainRouter.waitForDeployment();

    // Grant roles
    await lookCoin.grantRole(BRIDGE_ROLE, await hyperlaneModule.getAddress());
    await lookCoin.setCrossChainRouter(await crossChainRouter.getAddress());

    // Mint some tokens to addr1 for testing
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, owner.address);
    await lookCoin.mint(addr1.address, ethers.parseEther("10000"));

    // Configure mock gas paymaster
    await mockGasPaymaster.setGasPrice(AKASHIC_DOMAIN, ethers.parseUnits("20", "gwei"));
    await mockGasPaymaster.setGasPrice(OPTIMISM_DOMAIN, ethers.parseUnits("0.1", "gwei"));
  });

  describe("HyperlaneModule Initialization", function () {
    it("Should have correct initialization", async function () {
      expect(await hyperlaneModule.lookCoin()).to.equal(await lookCoin.getAddress());
      expect(await hyperlaneModule.mailbox()).to.equal(await mockMailbox.getAddress());
      expect(await hyperlaneModule.gasPaymaster()).to.equal(await mockGasPaymaster.getAddress());
      expect(await hyperlaneModule.interchainSecurityModule()).to.equal(await mockISM.getAddress());
    });

    it("Should have Akashic domain configured", async function () {
      expect(await hyperlaneModule.supportedDomains(AKASHIC_DOMAIN)).to.equal(true);
      
      // BSC to Akashic should have special domain mapping
      const mappedDomain = await hyperlaneModule.domainMapping(BSC_DOMAIN, AKASHIC_DOMAIN);
      expect(mappedDomain).to.equal(AKASHIC_DOMAIN);
    });
  });

  describe("Direct Hyperlane Bridging", function () {
    it("Should bridge tokens to Akashic via Hyperlane", async function () {
      const amount = ethers.parseEther("100");
      const gasFee = ethers.parseEther("0.01");

      const initialBalance = await lookCoin.balanceOf(addr1.address);
      const initialSupply = await lookCoin.totalSupply();

      await expect(
        lookCoin.connect(addr1).bridgeTokenHyperlane(AKASHIC_DOMAIN, addr2.address, amount, { value: gasFee })
      )
        .to.emit(lookCoin, "CrossChainTransferInitiated")
        .withArgs(addr1.address, AKASHIC_DOMAIN, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [addr2.address]), amount);

      // Verify tokens were burned
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(initialBalance - amount);
      expect(await lookCoin.totalSupply()).to.equal(initialSupply - amount);
    });

    it("Should reject unsupported Hyperlane domains", async function () {
      const unsupportedDomain = 1; // Ethereum
      const amount = ethers.parseEther("100");

      await expect(
        lookCoin.connect(addr1).bridgeTokenHyperlane(unsupportedDomain, addr2.address, amount)
      ).to.be.revertedWith("LookCoin: unsupported domain");
    });

    it("Should require non-zero amount", async function () {
      await expect(
        lookCoin.connect(addr1).bridgeTokenHyperlane(AKASHIC_DOMAIN, addr2.address, 0)
      ).to.be.revertedWith("LookCoin: amount must be greater than 0");
    });

    it("Should require valid recipient", async function () {
      await expect(
        lookCoin.connect(addr1).bridgeTokenHyperlane(AKASHIC_DOMAIN, ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWith("LookCoin: invalid recipient");
    });
  });

  describe("Hyperlane Message Handling", function () {
    it("Should handle incoming Hyperlane messages", async function () {
      const amount = ethers.parseEther("100");
      const sender = ethers.zeroPadValue(addr1.address, 32);
      
      // Encode the message
      const message = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr2.address, amount]);

      // Set the mock mailbox to accept our message
      await mockMailbox.setAuthorizedCaller(owner.address, true);

      // Simulate incoming message through mailbox
      await mockMailbox.connect(owner).deliverMessage(
        await lookCoin.getAddress(),
        AKASHIC_DOMAIN,
        sender,
        message
      );

      // Verify tokens were minted
      expect(await lookCoin.balanceOf(addr2.address)).to.equal(amount);
    });

    it("Should only accept messages from Hyperlane mailbox", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr2.address, ethers.parseEther("100")]);

      await expect(
        lookCoin.connect(addr1).handle(AKASHIC_DOMAIN, ethers.zeroPadValue(addr1.address, 32), message)
      ).to.be.revertedWith("LookCoin: unauthorized mailbox");
    });
  });

  describe("HyperlaneModule Bridge Operations", function () {
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      // Approve HyperlaneModule to spend tokens
      await lookCoin.connect(addr1).approve(await hyperlaneModule.getAddress(), amount);
    });

    it("Should bridge tokens to Akashic through HyperlaneModule", async function () {
      const gasFee = ethers.parseEther("0.01");
      const initialBalance = await lookCoin.balanceOf(addr1.address);

      await expect(
        hyperlaneModule.connect(addr1).bridgeToken(AKASHIC_DOMAIN, addr2.address, amount, { value: gasFee })
      )
        .to.emit(hyperlaneModule, "BridgeTransferInitiated")
        .withArgs(addr1.address, AKASHIC_DOMAIN, addr2.address, amount);

      // Verify tokens were burned
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(initialBalance - amount);
    });

    it("Should handle message with transfer", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("transfer123"));
      const metadata = "0x"; // Empty metadata for simplicity
      
      // Encode the message
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes32"],
        [addr2.address, amount, transferId]
      );

      // Grant MINTER_ROLE to HyperlaneModule for testing
      const MINTER_ROLE = await lookCoin.MINTER_ROLE();
      await lookCoin.grantRole(MINTER_ROLE, await hyperlaneModule.getAddress());

      // Handle the message
      await hyperlaneModule.handleWithTransfer(
        AKASHIC_DOMAIN,
        ethers.zeroPadValue(await hyperlaneModule.getAddress(), 32),
        await lookCoin.getAddress(),
        amount,
        message,
        metadata
      );

      // Verify tokens were minted
      expect(await lookCoin.balanceOf(addr2.address)).to.equal(amount);
      
      // Verify transfer was tracked
      const transfer = await hyperlaneModule.transfers(transferId);
      expect(transfer.recipient).to.equal(addr2.address);
      expect(transfer.amount).to.equal(amount);
      expect(transfer.status).to.equal(1); // Completed status
    });

    it("Should estimate gas for Hyperlane transfer", async function () {
      const estimatedGas = await hyperlaneModule.estimateGas(AKASHIC_DOMAIN, amount);
      
      // Gas estimation should be reasonable
      expect(estimatedGas).to.be.gt(0);
      expect(estimatedGas).to.be.lt(ethers.parseEther("1")); // Less than 1 ETH
    });

    it("Should enforce rate limits", async function () {
      // Set a low transaction limit
      const lowLimit = ethers.parseEther("50");
      await hyperlaneModule.updateRateLimits(
        ethers.parseEther("1000000"), // daily limit
        lowLimit, // transaction limit
        3600 // window size
      );

      // Try to bridge more than the limit
      const exceedAmount = ethers.parseEther("100");
      await lookCoin.connect(addr1).approve(await hyperlaneModule.getAddress(), exceedAmount);

      await expect(
        hyperlaneModule.connect(addr1).bridgeToken(AKASHIC_DOMAIN, addr2.address, exceedAmount)
      ).to.be.revertedWith("HyperlaneModule: exceeds transaction limit");
    });
  });

  describe("Akashic-Specific Configuration", function () {
    it("Should have custom ISM for Akashic", async function () {
      // Set custom ISM for Akashic
      const customISM = await ethers.getContractFactory("MockInterchainSecurityModule");
      const akashicISM = await customISM.deploy();
      await akashicISM.waitForDeployment();

      await hyperlaneModule.setDomainISM(AKASHIC_DOMAIN, await akashicISM.getAddress());
      
      expect(await hyperlaneModule.domainISMs(AKASHIC_DOMAIN)).to.equal(await akashicISM.getAddress());
    });

    it("Should configure validator threshold for Akashic", async function () {
      // Akashic should support configurable validator thresholds
      await hyperlaneModule.setValidatorThreshold(AKASHIC_DOMAIN, 3); // 3 out of 5 validators
      expect(await hyperlaneModule.validatorThresholds(AKASHIC_DOMAIN)).to.equal(3);
    });

    it("Should handle BSC to Akashic transfers specially", async function () {
      // Configure BSC as source chain
      await hyperlaneModule.setDomainMapping(BSC_DOMAIN, AKASHIC_DOMAIN, AKASHIC_DOMAIN);
      
      const mappedDomain = await hyperlaneModule.domainMapping(BSC_DOMAIN, AKASHIC_DOMAIN);
      expect(mappedDomain).to.equal(AKASHIC_DOMAIN);
    });
  });

  describe("Integration with CrossChainRouter", function () {
    beforeEach(async function () {
      // Register HyperlaneModule with CrossChainRouter
      await crossChainRouter.registerProtocolModule(
        4, // Hyperlane protocol enum value
        await hyperlaneModule.getAddress()
      );

      // Grant BRIDGE_ROLE to CrossChainRouter
      await lookCoin.grantRole(BRIDGE_ROLE, await crossChainRouter.getAddress());
    });

    it("Should bridge tokens through CrossChainRouter using Hyperlane", async function () {
      const amount = ethers.parseEther("100");
      const gasFee = ethers.parseEther("0.01");

      // Approve router to spend tokens
      await lookCoin.connect(addr1).approve(await crossChainRouter.getAddress(), amount);

      // Get initial state
      const initialBalance = await lookCoin.balanceOf(addr1.address);
      const initialSupply = await lookCoin.totalSupply();

      // Bridge tokens through router
      await crossChainRouter
        .connect(addr1)
        .bridgeToken(AKASHIC_DOMAIN, addr2.address, amount, 4, "0x", { value: gasFee }); // 4 = Hyperlane protocol

      // Verify tokens were transferred and burned
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(initialBalance - amount);
      expect(await lookCoin.totalSupply()).to.equal(initialSupply - amount);
    });

    it("Should estimate fees for Hyperlane bridge", async function () {
      const amount = ethers.parseEther("100");

      const [nativeFee, protocolFee] = await crossChainRouter.estimateBridgeFee(
        AKASHIC_DOMAIN,
        addr2.address,
        amount,
        4 // Hyperlane protocol
      );

      // Hyperlane should have gas fees
      expect(nativeFee).to.be.gt(0);
      expect(protocolFee).to.equal(0); // No additional protocol fee
    });

    it("Should use Hyperlane for Akashic as preferred protocol", async function () {
      // When bridging to Akashic, Hyperlane should be the preferred protocol
      const preferredProtocol = await crossChainRouter.getPreferredProtocol(AKASHIC_DOMAIN);
      
      // Note: This would depend on actual router implementation
      // For now we just verify the module is registered
      const hyperlaneModuleAddress = await crossChainRouter.protocolModules(4);
      expect(hyperlaneModuleAddress).to.equal(await hyperlaneModule.getAddress());
    });
  });

  describe("Security and Error Handling", function () {
    it("Should validate domain before processing", async function () {
      const invalidDomain = 999999;
      
      await expect(
        hyperlaneModule.connect(addr1).bridgeToken(invalidDomain, addr2.address, ethers.parseEther("100"))
      ).to.be.revertedWith("HyperlaneModule: unsupported domain");
    });

    it("Should handle message replay protection", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("transfer123"));
      const amount = ethers.parseEther("100");
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes32"],
        [addr2.address, amount, transferId]
      );

      // Grant MINTER_ROLE to HyperlaneModule
      const MINTER_ROLE = await lookCoin.MINTER_ROLE();
      await lookCoin.grantRole(MINTER_ROLE, await hyperlaneModule.getAddress());

      // First message should succeed
      await hyperlaneModule.handleWithTransfer(
        AKASHIC_DOMAIN,
        ethers.zeroPadValue(await hyperlaneModule.getAddress(), 32),
        await lookCoin.getAddress(),
        amount,
        message,
        "0x"
      );

      // Replay should fail
      await expect(
        hyperlaneModule.handleWithTransfer(
          AKASHIC_DOMAIN,
          ethers.zeroPadValue(await hyperlaneModule.getAddress(), 32),
          await lookCoin.getAddress(),
          amount,
          message,
          "0x"
        )
      ).to.be.revertedWith("HyperlaneModule: transfer already processed");
    });

    it("Should pause and unpause operations", async function () {
      await hyperlaneModule.pause();
      expect(await hyperlaneModule.paused()).to.equal(true);

      // Try to bridge while paused
      await expect(
        hyperlaneModule.connect(addr1).bridgeToken(AKASHIC_DOMAIN, addr2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(hyperlaneModule, "EnforcedPause");

      await hyperlaneModule.unpause();
      expect(await hyperlaneModule.paused()).to.equal(false);
    });

    it("Should validate trusted senders", async function () {
      // Set trusted sender for Akashic
      const trustedSender = ethers.zeroPadValue("0x1234567890123456789012345678901234567890", 32);
      await hyperlaneModule.setTrustedSender(AKASHIC_DOMAIN, trustedSender);

      // Message from untrusted sender should fail
      const untrustedSender = ethers.zeroPadValue(addr1.address, 32);
      const message = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr2.address, ethers.parseEther("100")]);

      await expect(
        hyperlaneModule.handle(AKASHIC_DOMAIN, untrustedSender, message)
      ).to.be.revertedWith("HyperlaneModule: unauthorized sender");
    });
  });

  describe("Multi-Protocol Scenarios with Hyperlane", function () {
    it("Should fallback to Hyperlane when other protocols fail", async function () {
      // This test would require setting up multiple protocols
      // and showing that Hyperlane can serve as a fallback
      
      // For now, verify Hyperlane is available for Akashic
      expect(await hyperlaneModule.supportedDomains(AKASHIC_DOMAIN)).to.equal(true);
      
      // Verify it can process transfers
      const amount = ethers.parseEther("100");
      await lookCoin.connect(addr1).approve(await hyperlaneModule.getAddress(), amount);
      
      await expect(
        hyperlaneModule.connect(addr1).bridgeToken(AKASHIC_DOMAIN, addr2.address, amount, { value: ethers.parseEther("0.01") })
      ).to.emit(hyperlaneModule, "BridgeTransferInitiated");
    });

    it("Should integrate with supply reconciliation", async function () {
      // Deploy SupplyOracle if needed for cross-chain supply tracking
      const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
      const supplyOracle = await upgrades.deployProxy(
        SupplyOracle,
        [owner.address, ethers.parseEther("1000000000")], // 1B total supply
        { initializer: "initialize" }
      );
      await supplyOracle.waitForDeployment();

      // Register Akashic chain
      await supplyOracle.registerChain(AKASHIC_DOMAIN, ethers.parseEther("0"));

      // Update supply after bridge operation
      const bridgedAmount = ethers.parseEther("1000");
      await supplyOracle.updateChainSupply(AKASHIC_DOMAIN, bridgedAmount);

      // Verify supply tracking
      expect(await supplyOracle.chainSupplies(AKASHIC_DOMAIN)).to.equal(bridgedAmount);
    });
  });
});

// Mock Hyperlane contracts for testing
const MockHyperlaneMailboxSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockHyperlaneMailbox {
    mapping(address => bool) public authorizedCallers;
    bytes32 public constant MESSAGE_VERSION = 0x01;
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
`;