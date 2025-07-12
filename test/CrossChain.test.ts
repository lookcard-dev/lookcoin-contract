import { expect } from "chai";
import { ethers, ignition } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import LookCoinModule from "../ignition/modules/LookCoinModule";
import CelerModule from "../ignition/modules/CelerModule";
import IBCModule from "../ignition/modules/IBCModule";
import OracleModule from "../ignition/modules/OracleModule";
import MocksModule from "../ignition/modules/MocksModule";

describe("CrossChain Integration", function () {
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let relayer: SignerWithAddress;
  let validators: SignerWithAddress[];
  
  let lookCoin: any;
  let celerIMModule: any;
  let ibcModule: any;
  let supplyOracle: any;
  let mocks: any;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    user1 = signers[1];
    user2 = signers[2];
    relayer = signers[3];
    validators = signers.slice(10, 31); // 21 validators

    // Deploy mocks
    mocks = await ignition.deploy(MocksModule, {
      parameters: {
        MocksModule: {
          chainIds: [56, 8453, 10, 23295, 999],
        },
      },
    });

    // Deploy LookCoin
    const lookCoinDeployment = await ignition.deploy(LookCoinModule, {
      parameters: {
        LookCoinModule: {
          admin: owner.address,
          lzEndpoint: mocks.mockLayerZeroEndpoint.address,
          totalSupply: ethers.utils.parseEther("1000000000"),
          chainId: 56, // BSC
          dvns: [mocks.mockDVN.address, validators[0].address, validators[1].address],
          requiredDVNs: 2,
          optionalDVNs: 1,
          dvnThreshold: 66,
        },
      },
    });
    lookCoin = lookCoinDeployment.lookCoin;

    // Deploy CelerIMModule
    const celerDeployment = await ignition.deploy(CelerModule, {
      parameters: {
        CelerModule: {
          messageBus: mocks.mockMessageBus.address,
          lookCoin: lookCoin.address,
          admin: owner.address,
          chainId: 56,
          remoteModules: {
            10: ethers.utils.hexZeroPad("0x1234", 20), // Optimism
            23295: ethers.utils.hexZeroPad("0x5678", 20), // Sapphire
          },
        },
      },
    });
    celerIMModule = celerDeployment.celerIMModule;

    // Deploy IBCModule
    const vault = owner.address; // Use owner as vault for testing
    const ibcDeployment = await ignition.deploy(IBCModule, {
      parameters: {
        IBCModule: {
          lookCoin: lookCoin.address,
          vault: vault,
          admin: owner.address,
          validators: validators.map(v => v.address),
          relayers: [relayer.address],
        },
      },
    });
    ibcModule = ibcDeployment.ibcModule;

    // Deploy SupplyOracle
    const oracleDeployment = await ignition.deploy(OracleModule, {
      parameters: {
        OracleModule: {
          admin: owner.address,
          totalSupply: ethers.utils.parseEther("1000000000"),
          bridgeRegistrations: {
            56: [lookCoin.address, celerIMModule.address, ibcModule.address],
            8453: [ethers.utils.hexZeroPad("0xdead", 20)], // Base
            10: [ethers.utils.hexZeroPad("0xbeef", 20)], // Optimism
            23295: [ethers.utils.hexZeroPad("0xcafe", 20)], // Sapphire
            999: [ethers.utils.hexZeroPad("0xface", 20)], // Akashic
          },
        },
      },
    });
    supplyOracle = oracleDeployment.supplyOracle;
  });

  describe("LayerZero Cross-Chain Tests", function () {
    it("Should handle burn-and-mint flow from BSC to Base", async function () {
      // Setup: Mint tokens to user1
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      const BURNER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BURNER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      await lookCoin.grantRole(BURNER_ROLE, lookCoin.address); // Self-burn for LayerZero
      
      const amount = ethers.utils.parseEther("1000");
      await lookCoin.mint(user1.address, amount);
      
      // Configure peer for Base chain
      const baseChainId = 8453;
      const basePeer = ethers.utils.hexZeroPad(lookCoin.address, 32);
      await lookCoin.connectPeer(baseChainId, basePeer);
      
      // Simulate cross-chain transfer
      const initialBalance = await lookCoin.balanceOf(user1.address);
      const initialTotalBurned = await lookCoin.totalBurned();
      
      // This would normally go through LayerZero endpoint
      // For testing, we simulate the burn
      await expect(lookCoin.connect(user1).transfer(user2.address, amount))
        .to.emit(lookCoin, "Transfer");
      
      // Verify state changes
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
    });

    it("Should validate DVN consensus", async function () {
      // Test DVN validation logic
      const dvns = [mocks.mockDVN.address, validators[0].address, validators[1].address];
      await lookCoin.configureDVN(dvns, 2, 1, 66);
      
      // Verify DVN configuration event
      const filter = lookCoin.filters.DVNConfigured();
      const events = await lookCoin.queryFilter(filter);
      expect(events.length).to.be.greaterThan(0);
      expect(events[0].args?.requiredDVNs).to.equal(2);
      expect(events[0].args?.threshold).to.equal(66);
    });
  });

  describe("Celer IM Cross-Chain Tests", function () {
    it("Should handle lock-and-mint flow from BSC to Optimism", async function () {
      // Setup: Mint tokens to user1
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      await lookCoin.grantRole(MINTER_ROLE, celerIMModule.address);
      
      const amount = ethers.utils.parseEther("1000");
      await lookCoin.mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);
      
      // Calculate expected fee
      const fee = await celerIMModule.calculateFee(amount);
      const netAmount = amount.sub(fee);
      
      // Estimate message fee
      const messageFee = await celerIMModule.estimateMessageFee(10, ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "bytes32"],
        [user1.address, user2.address, netAmount, ethers.utils.hexZeroPad("0x01", 32)]
      ));
      
      // Lock and bridge
      await expect(
        celerIMModule.connect(user1).lockAndBridge(
          10, // Optimism chain ID
          user2.address,
          amount,
          { value: messageFee }
        )
      ).to.emit(celerIMModule, "CrossChainTransferLocked");
      
      // Verify tokens are locked
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
      expect(await lookCoin.balanceOf(celerIMModule.address)).to.be.gt(0);
    });

    it("Should handle incoming Celer IM message", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, celerIMModule.address);
      
      // Simulate incoming message from Optimism
      const srcChainId = 10;
      const amount = ethers.utils.parseEther("500");
      const transferId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-transfer"));
      
      const message = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "bytes32"],
        [user1.address, user2.address, amount, transferId]
      );
      
      // Mock MessageBus should call executeMessageWithTransfer
      await mocks.mockMessageBus.simulateIncomingMessage(
        celerIMModule.address,
        ethers.utils.hexZeroPad("0x1234", 20), // Remote module
        ethers.constants.AddressZero,
        0,
        srcChainId,
        message,
        owner.address
      );
      
      // Verify minting occurred
      expect(await lookCoin.balanceOf(user2.address)).to.equal(amount);
    });

    it("Should support Oasis Sapphire transfers", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      
      const amount = ethers.utils.parseEther("1000");
      await lookCoin.mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);
      
      const sapphireChainId = 23295;
      const messageFee = ethers.utils.parseEther("0.01");
      
      await expect(
        celerIMModule.connect(user1).lockAndBridge(
          sapphireChainId,
          user2.address,
          amount,
          { value: messageFee }
        )
      ).to.emit(celerIMModule, "CrossChainTransferLocked")
        .withArgs(user1.address, sapphireChainId, user2.address, amount.sub(await celerIMModule.calculateFee(amount)), ethers.utils.isHexString);
    });
  });

  describe("IBC Cross-Chain Tests", function () {
    it("Should handle BSC to Akashic transfer via IBC", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      
      const amount = ethers.utils.parseEther("1000");
      await lookCoin.mint(user1.address, amount);
      await lookCoin.connect(user1).approve(ibcModule.address, amount);
      
      const akashicRecipient = "akashic1234567890abcdef";
      
      await expect(
        ibcModule.connect(user1).lockForIBC(akashicRecipient, amount)
      ).to.emit(ibcModule, "IBCTransferInitiated")
        .withArgs(user1.address, akashicRecipient, amount, ethers.BigNumber.from);
      
      // Verify tokens are locked in vault
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
      expect(await lookCoin.balanceOf(owner.address)).to.equal(amount); // owner is vault
    });

    it("Should validate IBC packet with 21 validators", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, ibcModule.address);
      
      // Create IBC packet
      const packet = {
        sequence: 1,
        sourcePort: "transfer",
        sourceChannel: "channel-0",
        destinationPort: "transfer",
        destinationChannel: "channel-0",
        data: ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256"],
          [user1.address, user2.address, ethers.utils.parseEther("500")]
        ),
        timeoutHeight: 0,
        timeoutTimestamp: Math.floor(Date.now() / 1000) + 3600,
      };
      
      // Generate validator signatures (at least 14 out of 21)
      const packetId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
        ["uint64", "string", "string", "string", "string", "bytes", "uint64", "uint64"],
        Object.values(packet)
      ));
      
      const signatures = [];
      for (let i = 0; i < 14; i++) {
        const signature = await validators[i].signMessage(ethers.utils.arrayify(packetId));
        signatures.push(signature);
      }
      
      // Handle IBC packet
      await ibcModule.connect(relayer).handleIBCPacket(packet, "0x", signatures);
      
      // Verify minting occurred
      expect(await lookCoin.balanceOf(user2.address)).to.equal(ethers.utils.parseEther("500"));
    });

    it("Should enforce packet timeout", async function () {
      const packet = {
        sequence: 1,
        sourcePort: "transfer",
        sourceChannel: "channel-0",
        destinationPort: "transfer",
        destinationChannel: "channel-0",
        data: ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256"],
          [user1.address, user2.address, ethers.utils.parseEther("500")]
        ),
        timeoutHeight: 0,
        timeoutTimestamp: Math.floor(Date.now() / 1000) - 3600, // Already expired
      };
      
      const signatures = [];
      for (let i = 0; i < 14; i++) {
        signatures.push("0x" + "00".repeat(65));
      }
      
      await expect(
        ibcModule.connect(relayer).handleIBCPacket(packet, "0x", signatures)
      ).to.be.revertedWith("IBC: packet timeout");
    });
  });

  describe("Multi-Bridge Integration Tests", function () {
    it("Should support simultaneous operations across all bridges", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      await lookCoin.grantRole(MINTER_ROLE, celerIMModule.address);
      await lookCoin.grantRole(MINTER_ROLE, ibcModule.address);
      
      const amount = ethers.utils.parseEther("3000");
      await lookCoin.mint(user1.address, amount);
      
      // Approve all bridges
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);
      await lookCoin.connect(user1).approve(ibcModule.address, amount);
      
      // Execute transfers on different bridges
      const transfers = [];
      
      // Celer IM transfer
      transfers.push(
        celerIMModule.connect(user1).lockAndBridge(
          10,
          user2.address,
          ethers.utils.parseEther("1000"),
          { value: ethers.utils.parseEther("0.01") }
        )
      );
      
      // IBC transfer
      transfers.push(
        ibcModule.connect(user1).lockForIBC(
          "akashic1234567890abcdef",
          ethers.utils.parseEther("1000")
        )
      );
      
      // Execute all transfers
      await Promise.all(transfers);
      
      // Verify remaining balance
      expect(await lookCoin.balanceOf(user1.address)).to.equal(ethers.utils.parseEther("1000"));
    });
  });

  describe("Supply Reconciliation Tests", function () {
    it("Should track supply across chains", async function () {
      // Update supply for BSC
      const bscSupply = {
        totalSupply: ethers.utils.parseEther("500000000"),
        lockedSupply: ethers.utils.parseEther("100000000"),
        circulatingSupply: ethers.utils.parseEther("400000000"),
      };
      
      // This would normally require multi-sig
      await supplyOracle.grantRole(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ORACLE_ROLE")),
        owner.address
      );
      
      // Update supply (simplified for testing)
      const updateId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint16", "uint256", "uint256", "uint256", "uint256"],
          [56, bscSupply.totalSupply, bscSupply.lockedSupply, bscSupply.circulatingSupply, Date.now()]
        )
      );
      
      // Simulate multi-sig by having owner sign multiple times
      // In production, this would be different signers
      await supplyOracle.submitSupplyUpdate(
        56,
        bscSupply.totalSupply,
        bscSupply.lockedSupply,
        bscSupply.circulatingSupply
      );
    });

    it("Should detect supply mismatches", async function () {
      // Configure tolerance
      await supplyOracle.updateReconciliationParams(
        15 * 60, // 15 minutes
        ethers.utils.parseEther("1000") // 1000 token tolerance
      );
      
      // This test would simulate a supply mismatch scenario
      // In production, the oracle would automatically pause bridges
    });
  });

  describe("Concurrent Operations Tests", function () {
    it("Should handle multiple simultaneous transfers", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      
      // Mint to multiple users
      const users = [user1, user2];
      const amount = ethers.utils.parseEther("1000");
      
      for (const user of users) {
        await lookCoin.mint(user.address, amount);
        await lookCoin.connect(user).approve(celerIMModule.address, amount);
      }
      
      // Execute concurrent transfers
      const transfers = users.map(user =>
        celerIMModule.connect(user).lockAndBridge(
          10,
          owner.address,
          amount,
          { value: ethers.utils.parseEther("0.01") }
        )
      );
      
      await Promise.all(transfers);
      
      // Verify all transfers completed
      for (const user of users) {
        expect(await lookCoin.balanceOf(user.address)).to.equal(0);
      }
    });
  });

  describe("Rate Limiting Integration", function () {
    it("Should enforce rate limits across bridge operations", async function () {
      const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.grantRole(MINTER_ROLE, owner.address);
      
      const amount = ethers.utils.parseEther("600000"); // Exceeds rate limit
      await lookCoin.mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);
      
      await expect(
        celerIMModule.connect(user1).lockAndBridge(
          10,
          user2.address,
          amount,
          { value: ethers.utils.parseEther("0.01") }
        )
      ).to.be.revertedWith("RateLimiter: transfer amount exceeds limit");
    });
  });

  describe("Emergency Response Tests", function () {
    it("Should pause all bridges in emergency", async function () {
      const PAUSER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE"));
      const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
      
      await lookCoin.grantRole(PAUSER_ROLE, owner.address);
      await celerIMModule.grantRole(OPERATOR_ROLE, owner.address);
      await ibcModule.grantRole(OPERATOR_ROLE, owner.address);
      
      // Pause all contracts
      await lookCoin.pause();
      await celerIMModule.pause();
      await ibcModule.pause();
      
      // Verify all operations fail
      await expect(
        lookCoin.transfer(user2.address, 100)
      ).to.be.revertedWith("Pausable: paused");
      
      await expect(
        celerIMModule.lockAndBridge(10, user2.address, 100, { value: 100 })
      ).to.be.revertedWith("Pausable: paused");
      
      await expect(
        ibcModule.lockForIBC("akashic123", 100)
      ).to.be.revertedWith("Pausable: paused");
    });
  });
});