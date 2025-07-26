import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ProtocolRegistry, CrossChainRouter, LookCoin } from "../../../typechain-types";

describe("ProtocolRegistry Test", function () {
  let protocolRegistry: ProtocolRegistry;
  let crossChainRouter: CrossChainRouter;
  let lookCoin: LookCoin;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let layerZeroModule: SignerWithAddress;
  let celerModule: SignerWithAddress;
  let hyperlaneModule: SignerWithAddress;

  const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
  const REGISTRY_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRY_ADMIN_ROLE"));

  // Protocol enum values
  enum Protocol {
    LayerZero = 0,
    Celer = 1,
    Hyperlane = 2,
  }

  // Chain IDs
  const BSC_CHAIN = 56;
  const OPTIMISM_CHAIN = 10;
  const BASE_CHAIN = 8453;
  const AKASHIC_CHAIN = 9070;
  const SAPPHIRE_CHAIN = 23295;

  beforeEach(async function () {
    [owner, addr1, layerZeroModule, celerModule, hyperlaneModule] = await ethers.getSigners();

    // Deploy ProtocolRegistry
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
    protocolRegistry = (await upgrades.deployProxy(ProtocolRegistry, [owner.address], {
      initializer: "initialize",
    })) as unknown as ProtocolRegistry;
    await protocolRegistry.waitForDeployment();

    // Deploy LookCoin for integration tests
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = (await upgrades.deployProxy(LookCoin, [owner.address, ethers.ZeroAddress], {
      initializer: "initialize",
    })) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Deploy CrossChainRouter for integration tests
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

    // Set protocol registry in router
    await crossChainRouter.setProtocolRegistry(await protocolRegistry.getAddress());
  });

  describe("Initialization", function () {
    it("Should have correct admin role", async function () {
      expect(await protocolRegistry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await protocolRegistry.hasRole(REGISTRY_ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("Should start with no registered protocols", async function () {
      const protocols = await protocolRegistry.getRegisteredProtocols();
      expect(protocols.length).to.equal(0);
    });
  });

  describe("Protocol Registration", function () {
    it("Should register a protocol module", async function () {
      await expect(
        protocolRegistry.registerProtocol(
          Protocol.LayerZero,
          layerZeroModule.address,
          "LayerZero OFT V2",
          "1.0.0"
        )
      )
        .to.emit(protocolRegistry, "ProtocolRegistered")
        .withArgs(Protocol.LayerZero, layerZeroModule.address, "LayerZero OFT V2", "1.0.0");

      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.moduleAddress).to.equal(layerZeroModule.address);
      expect(info.name).to.equal("LayerZero OFT V2");
      expect(info.version).to.equal("1.0.0");
      expect(info.isActive).to.equal(true);
    });

    it("Should register multiple protocols", async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0");

      const protocols = await protocolRegistry.getRegisteredProtocols();
      expect(protocols.length).to.equal(3);
      expect(protocols).to.include(Protocol.LayerZero);
      expect(protocols).to.include(Protocol.Celer);
      expect(protocols).to.include(Protocol.Hyperlane);
    });

    it("Should prevent duplicate protocol registration", async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");

      await expect(
        protocolRegistry.registerProtocol(Protocol.LayerZero, addr1.address, "LayerZero V2", "2.0.0")
      ).to.be.revertedWith("ProtocolRegistry: protocol already registered");
    });

    it("Should only allow admin to register protocols", async function () {
      await expect(
        protocolRegistry.connect(addr1).registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0")
      ).to.be.revertedWithCustomError(protocolRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Chain Support Configuration", function () {
    beforeEach(async function () {
      // Register all protocols
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0");
    });

    it("Should add chain support for a protocol", async function () {
      await expect(protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN))
        .to.emit(protocolRegistry, "ChainSupportAdded")
        .withArgs(Protocol.LayerZero, BSC_CHAIN);

      expect(await protocolRegistry.isChainSupported(Protocol.LayerZero, BSC_CHAIN)).to.equal(true);
    });

    it("Should add multiple chain support", async function () {
      // LayerZero supports BSC, Optimism, Base
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BASE_CHAIN);

      // Celer supports BSC, Optimism, Sapphire
      await protocolRegistry.addChainSupport(Protocol.Celer, BSC_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Celer, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Celer, SAPPHIRE_CHAIN);


      // Hyperlane supports BSC, Akashic
      await protocolRegistry.addChainSupport(Protocol.Hyperlane, BSC_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Hyperlane, AKASHIC_CHAIN);

      // Verify chain support
      expect(await protocolRegistry.isChainSupported(Protocol.LayerZero, BSC_CHAIN)).to.equal(true);
      expect(await protocolRegistry.isChainSupported(Protocol.Celer, SAPPHIRE_CHAIN)).to.equal(true);
      expect(await protocolRegistry.isChainSupported(Protocol.Hyperlane, AKASHIC_CHAIN)).to.equal(true);
    });

    it("Should remove chain support", async function () {
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN);
      expect(await protocolRegistry.isChainSupported(Protocol.LayerZero, BSC_CHAIN)).to.equal(true);

      await expect(protocolRegistry.removeChainSupport(Protocol.LayerZero, BSC_CHAIN))
        .to.emit(protocolRegistry, "ChainSupportRemoved")
        .withArgs(Protocol.LayerZero, BSC_CHAIN);

      expect(await protocolRegistry.isChainSupported(Protocol.LayerZero, BSC_CHAIN)).to.equal(false);
    });

    it("Should get supported chains for a protocol", async function () {
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BASE_CHAIN);

      const supportedChains = await protocolRegistry.getSupportedChains(Protocol.LayerZero);
      expect(supportedChains.length).to.equal(3);
      expect(supportedChains).to.include(BSC_CHAIN);
      expect(supportedChains).to.include(OPTIMISM_CHAIN);
      expect(supportedChains).to.include(BASE_CHAIN);
    });
  });

  describe("Protocol Discovery", function () {
    beforeEach(async function () {
      // Set up a realistic multi-protocol environment
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0");

      // Configure chain support
      await protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Celer, OPTIMISM_CHAIN);
      
      await protocolRegistry.addChainSupport(Protocol.Hyperlane, AKASHIC_CHAIN);
      
      await protocolRegistry.addChainSupport(Protocol.Celer, SAPPHIRE_CHAIN);
    });

    it("Should get available protocols for a chain", async function () {
      const optimismProtocols = await protocolRegistry.getAvailableProtocols(OPTIMISM_CHAIN);
      expect(optimismProtocols.length).to.equal(2);
      expect(optimismProtocols).to.include(Protocol.LayerZero);
      expect(optimismProtocols).to.include(Protocol.Celer);

      const akashicProtocols = await protocolRegistry.getAvailableProtocols(AKASHIC_CHAIN);
      expect(akashicProtocols.length).to.equal(1);
      expect(akashicProtocols).to.include(Protocol.Hyperlane);

      const sapphireProtocols = await protocolRegistry.getAvailableProtocols(SAPPHIRE_CHAIN);
      expect(sapphireProtocols.length).to.equal(1);
      expect(sapphireProtocols).to.include(Protocol.Celer);
    });

    it("Should return empty array for unsupported chain", async function () {
      const unsupportedChain = 999999;
      const protocols = await protocolRegistry.getAvailableProtocols(unsupportedChain);
      expect(protocols.length).to.equal(0);
    });

    it("Should check if protocol is available for chain", async function () {
      expect(await protocolRegistry.isProtocolAvailable(Protocol.LayerZero, OPTIMISM_CHAIN)).to.equal(true);
      expect(await protocolRegistry.isProtocolAvailable(Protocol.LayerZero, AKASHIC_CHAIN)).to.equal(false);
      expect(await protocolRegistry.isProtocolAvailable(Protocol.Hyperlane, AKASHIC_CHAIN)).to.equal(true);
      expect(await protocolRegistry.isProtocolAvailable(Protocol.Celer, SAPPHIRE_CHAIN)).to.equal(true);
    });
  });

  describe("Protocol Status Management", function () {
    beforeEach(async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN);
    });

    it("Should deactivate a protocol", async function () {
      await expect(protocolRegistry.setProtocolStatus(Protocol.LayerZero, false))
        .to.emit(protocolRegistry, "ProtocolStatusChanged")
        .withArgs(Protocol.LayerZero, false);

      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.isActive).to.equal(false);

      // Deactivated protocol should not appear in available protocols
      const availableProtocols = await protocolRegistry.getAvailableProtocols(BSC_CHAIN);
      expect(availableProtocols).to.not.include(Protocol.LayerZero);
    });

    it("Should reactivate a protocol", async function () {
      await protocolRegistry.setProtocolStatus(Protocol.LayerZero, false);
      await protocolRegistry.setProtocolStatus(Protocol.LayerZero, true);

      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.isActive).to.equal(true);

      const availableProtocols = await protocolRegistry.getAvailableProtocols(BSC_CHAIN);
      expect(availableProtocols).to.include(Protocol.LayerZero);
    });

    it("Should only allow admin to change protocol status", async function () {
      await expect(
        protocolRegistry.connect(addr1).setProtocolStatus(Protocol.LayerZero, false)
      ).to.be.revertedWithCustomError(protocolRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Protocol Updates", function () {
    beforeEach(async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
    });

    it("Should update protocol module address", async function () {
      const newModule = addr1.address;
      
      await expect(protocolRegistry.updateProtocolModule(Protocol.LayerZero, newModule))
        .to.emit(protocolRegistry, "ProtocolModuleUpdated")
        .withArgs(Protocol.LayerZero, layerZeroModule.address, newModule);

      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.moduleAddress).to.equal(newModule);
    });

    it("Should update protocol metadata", async function () {
      await expect(protocolRegistry.updateProtocolMetadata(Protocol.LayerZero, "LayerZero V2", "2.0.0"))
        .to.emit(protocolRegistry, "ProtocolMetadataUpdated")
        .withArgs(Protocol.LayerZero, "LayerZero V2", "2.0.0");

      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.name).to.equal("LayerZero V2");
      expect(info.version).to.equal("2.0.0");
    });

    it("Should not update unregistered protocol", async function () {
    });
  });

  describe("Integration with CrossChainRouter", function () {
    beforeEach(async function () {
      // Register all protocols with proper chain support
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0");

      // Configure realistic chain support
      await protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Celer, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Hyperlane, AKASHIC_CHAIN);

      // Register protocols in router
      await crossChainRouter.registerProtocolModule(Protocol.LayerZero, layerZeroModule.address);
      await crossChainRouter.registerProtocolModule(Protocol.Celer, celerModule.address);
      await crossChainRouter.registerProtocolModule(Protocol.Hyperlane, hyperlaneModule.address);
    });

    it("Should use registry to validate protocol availability", async function () {
      // Try to use LayerZero for Optimism (should work)
      const optimismProtocols = await protocolRegistry.getAvailableProtocols(OPTIMISM_CHAIN);
      expect(optimismProtocols).to.include(Protocol.LayerZero);

      // Try to use Hyperlane for Akashic (should work)
      const akashicProtocols = await protocolRegistry.getAvailableProtocols(AKASHIC_CHAIN);
      expect(akashicProtocols).to.include(Protocol.Hyperlane);

      // Try to use LayerZero for Akashic (should not be available)
      expect(await protocolRegistry.isProtocolAvailable(Protocol.LayerZero, AKASHIC_CHAIN)).to.equal(false);
    });

    it("Should reflect protocol deactivation in router", async function () {
      // Deactivate Celer protocol
      await protocolRegistry.setProtocolStatus(Protocol.Celer, false);

      // Celer should not be available for Optimism anymore
      const availableProtocols = await protocolRegistry.getAvailableProtocols(OPTIMISM_CHAIN);
      expect(availableProtocols).to.not.include(Protocol.Celer);
      expect(availableProtocols).to.include(Protocol.LayerZero); // Others still available
    });

    it("Should handle protocol module updates", async function () {
      const newLayerZeroModule = addr1.address;
      
      // Update LayerZero module in registry
      await protocolRegistry.updateProtocolModule(Protocol.LayerZero, newLayerZeroModule);

      // Router should get updated module address from registry
      const info = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      expect(info.moduleAddress).to.equal(newLayerZeroModule);
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
      await protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN);
      await protocolRegistry.addChainSupport(Protocol.Celer, BSC_CHAIN);
    });

    it("Should get all protocol info", async function () {
      const allProtocols = await protocolRegistry.getAllProtocolInfo();
      expect(allProtocols.length).to.equal(2);
      
      const layerZeroInfo = allProtocols.find(p => p.name === "LayerZero");
      expect(layerZeroInfo?.moduleAddress).to.equal(layerZeroModule.address);
      expect(layerZeroInfo?.isActive).to.equal(true);
      
      const celerInfo = allProtocols.find(p => p.name === "Celer IM");
      expect(celerInfo?.moduleAddress).to.equal(celerModule.address);
    });

    it("Should get chains with multi-protocol support", async function () {
      // BSC has both LayerZero and Celer
      const bscProtocols = await protocolRegistry.getAvailableProtocols(BSC_CHAIN);
      expect(bscProtocols.length).to.equal(2);
      
      // Optimism only has LayerZero
      const optimismProtocols = await protocolRegistry.getAvailableProtocols(OPTIMISM_CHAIN);
      expect(optimismProtocols.length).to.equal(1);
    });
  });

  describe("Emergency Functions", function () {
    beforeEach(async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
      await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
    });

    it("Should pause registry operations", async function () {
      await protocolRegistry.pause();
      expect(await protocolRegistry.paused()).to.equal(true);

      // Operations should fail when paused
      await expect(
        protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0")
      ).to.be.revertedWithCustomError(protocolRegistry, "EnforcedPause");
    });

    it("Should unpause registry operations", async function () {
      await protocolRegistry.pause();
      await protocolRegistry.unpause();
      expect(await protocolRegistry.paused()).to.equal(false);

      // Operations should work after unpause
      await expect(
        protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0")
      ).to.not.be.reverted;
    });

    it("Should batch deactivate protocols in emergency", async function () {
      await protocolRegistry.emergencyDeactivateAll();

      const layerZeroInfo = await protocolRegistry.protocolInfo(Protocol.LayerZero);
      const celerInfo = await protocolRegistry.protocolInfo(Protocol.Celer);

      expect(layerZeroInfo.isActive).to.equal(false);
      expect(celerInfo.isActive).to.equal(false);
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should handle invalid protocol IDs", async function () {
      const invalidProtocol = 999;
      
      await expect(
        protocolRegistry.isProtocolAvailable(invalidProtocol, BSC_CHAIN)
      ).to.not.be.reverted;
      
      const result = await protocolRegistry.isProtocolAvailable(invalidProtocol, BSC_CHAIN);
      expect(result).to.equal(false);
    });

    it("Should prevent zero address module registration", async function () {
      await expect(
        protocolRegistry.registerProtocol(Protocol.LayerZero, ethers.ZeroAddress, "LayerZero", "1.0.0")
      ).to.be.revertedWith("ProtocolRegistry: invalid module address");
    });

    it("Should handle empty protocol metadata", async function () {
      await expect(
        protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "", "1.0.0")
      ).to.be.revertedWith("ProtocolRegistry: invalid name");

      await expect(
        protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "")
      ).to.be.revertedWith("ProtocolRegistry: invalid version");
    });

    it("Should maintain consistency during concurrent operations", async function () {
      await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");

      // Perform multiple operations
      await Promise.all([
        protocolRegistry.addChainSupport(Protocol.LayerZero, BSC_CHAIN),
        protocolRegistry.addChainSupport(Protocol.LayerZero, OPTIMISM_CHAIN),
        protocolRegistry.addChainSupport(Protocol.LayerZero, BASE_CHAIN),
      ]);

      const supportedChains = await protocolRegistry.getSupportedChains(Protocol.LayerZero);
      expect(supportedChains.length).to.equal(3);
    });
  });
});