import { expect } from "chai";
import { ethers, ignition } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import LookCoinModule from "../ignition/modules/LookCoinModule";
import CelerModule from "../ignition/modules/CelerModule";
import OracleModule from "../ignition/modules/OracleModule";
import MocksModule from "../ignition/modules/MocksModule";
import { TEST_CHAINS, ROLES, getChainConfig } from "./utils/testConfig";

describe("CrossChain Integration", function () {
  let owner: SignerWithAddress;
  let vault: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let relayer: SignerWithAddress;
  let validators: SignerWithAddress[];

  let lookCoin: any;
  let celerIMModule: any;
  let supplyOracle: any;
  let mocks: any;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    vault = signers[1]; // MPC vault wallet
    user1 = signers[2];
    user2 = signers[3];
    relayer = signers[4];
    validators = signers.slice(10, 31); // 21 validators

    // Deploy mocks
    mocks = await ignition.deploy(MocksModule, {});

    // Deploy LookCoin
    const lookCoinDeployment = await ignition.deploy(LookCoinModule, {
      parameters: {
        LookCoinModule: {
          governanceVault: vault.address,
          lzEndpoint: mocks.mockLayerZeroEndpoint.address,
          totalSupply: getChainConfig("bscmainnet").totalSupply,
          chainId: TEST_CHAINS.BSC,
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
          governanceVault: vault.address,
          chainId: TEST_CHAINS.BSC,
          remoteModules: {
            [TEST_CHAINS.OPTIMISM]: ethers.zeroPadValue("0x1234", 20),
            [TEST_CHAINS.SAPPHIRE]: ethers.zeroPadValue("0x5678", 20),
          },
        },
      },
    });
    celerIMModule = celerDeployment.celerIMModule;


    // Deploy SupplyOracle
    const oracleDeployment = await ignition.deploy(OracleModule, {
      parameters: {
        OracleModule: {
          governanceVault: vault.address,
          totalSupply: getChainConfig("bscmainnet").totalSupply,
          bridgeRegistrations: {
            [TEST_CHAINS.BSC]: [lookCoin.address, celerIMModule.address],
            [TEST_CHAINS.BASE]: [ethers.zeroPadValue("0xdead", 20)],
            [TEST_CHAINS.OPTIMISM]: [ethers.zeroPadValue("0xbeef", 20)],
            [TEST_CHAINS.SAPPHIRE]: [ethers.zeroPadValue("0xcafe", 20)],
            [TEST_CHAINS.AKASHIC]: [ethers.zeroPadValue("0xface", 20)],
          },
        },
      },
    });
    supplyOracle = oracleDeployment.supplyOracle;
  });

  describe("LayerZero Cross-Chain Tests", function () {
    it("Should handle burn-and-mint flow from BSC to Base", async function () {
      // Setup: Mint tokens to user1
      const MINTER_ROLE = ROLES.MINTER_ROLE;
      const BURNER_ROLE = ROLES.BURNER_ROLE;
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);
      await lookCoin.connect(vault).grantRole(BURNER_ROLE, lookCoin.address); // Self-burn for LayerZero

      const amount = ethers.parseEther("1000");
      await lookCoin.connect(vault).mint(user1.address, amount);

      // Configure peer for Base chain
      const baseChainId = getChainConfig("base").layerZero.lzChainId;
      const basePeer = ethers.zeroPadValue(lookCoin.address, 32);
      await lookCoin.connect(vault).connectPeer(baseChainId, basePeer);

      // Simulate cross-chain transfer
      const initialBalance = await lookCoin.balanceOf(user1.address);
      const initialTotalBurned = await lookCoin.totalBurned();

      // This would normally go through LayerZero endpoint
      // For testing, we simulate the burn
      await expect(lookCoin.connect(user1).transfer(user2.address, amount)).to.emit(lookCoin, "Transfer");

      // Verify state changes
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
    });

    it("Should validate DVN consensus", async function () {
      // Test DVN validation logic
      const dvns = [mocks.mockDVN.address, validators[0].address, validators[1].address];
      await lookCoin.connect(vault).configureDVN(dvns, 2, 1, 66);

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
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, celerIMModule.address);

      const amount = ethers.parseEther("1000");
      await lookCoin.connect(vault).mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);

      // Calculate expected fee
      const fee = await celerIMModule.calculateFee(amount);
      const netAmount = amount - fee;

      // Estimate message fee
      const messageFee = await celerIMModule.estimateMessageFee(
        10,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint256", "bytes32"],
          [user1.address, user2.address, netAmount, ethers.zeroPadValue("0x01", 32)],
        ),
      );

      // Lock and bridge
      await expect(
        celerIMModule.connect(user1).lockAndBridge(
          10, // Optimism chain ID
          user2.address,
          amount,
          { value: messageFee },
        ),
      ).to.emit(celerIMModule, "CrossChainTransferLocked");

      // Verify tokens are locked
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
      expect(await lookCoin.balanceOf(celerIMModule.address)).to.be.gt(0);
    });

    it("Should handle incoming Celer IM message", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, celerIMModule.address);

      // Simulate incoming message from Optimism
      const srcChainId = 10;
      const amount = ethers.parseEther("500");
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer"));

      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "bytes32"],
        [user1.address, user2.address, amount, transferId],
      );

      // Mock MessageBus should call executeMessageWithTransfer
      await mocks.mockMessageBus.simulateIncomingMessage(
        celerIMModule.address,
        ethers.zeroPadValue("0x1234", 20), // Remote module
        ethers.ZeroAddress,
        0,
        srcChainId,
        message,
        owner.address,
      );

      // Verify minting occurred
      expect(await lookCoin.balanceOf(user2.address)).to.equal(amount);
    });

    it("Should support Oasis Sapphire transfers", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);

      const amount = ethers.parseEther("1000");
      await lookCoin.connect(vault).mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);

      const sapphireChainId = 23295;
      const messageFee = ethers.parseEther("0.01");

      await expect(
        celerIMModule.connect(user1).lockAndBridge(sapphireChainId, user2.address, amount, { value: messageFee }),
      )
        .to.emit(celerIMModule, "CrossChainTransferLocked")
        .withArgs(
          user1.address,
          sapphireChainId,
          user2.address,
          amount - (await celerIMModule.calculateFee(amount)),
          ethers.isHexString,
        );
    });
  });


  describe("Multi-Bridge Integration Tests", function () {
    it("Should support simultaneous operations across all bridges", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, celerIMModule.address);

      const amount = ethers.parseEther("3000");
      await lookCoin.connect(vault).mint(user1.address, amount);

      // Approve all bridges
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);

      // Execute transfers on different bridges
      const transfers = [];

      // Celer IM transfer
      transfers.push(
        celerIMModule
          .connect(user1)
          .lockAndBridge(10, user2.address, ethers.parseEther("1000"), { value: ethers.parseEther("0.01") }),
      );


      // Execute all transfers
      await Promise.all(transfers);

      // Verify remaining balance
      expect(await lookCoin.balanceOf(user1.address)).to.equal(ethers.parseEther("2000"));
    });
  });

  describe("Supply Reconciliation Tests", function () {
    it("Should track supply across chains", async function () {
      // Update supply for BSC
      const bscSupply = {
        totalSupply: ethers.parseEther("500000000"),
        lockedSupply: ethers.parseEther("100000000"),
        circulatingSupply: ethers.parseEther("400000000"),
      };

      // This would normally require multi-sig
      await supplyOracle.connect(vault).grantRole(ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE")), vault.address);

      // Update supply (simplified for testing)
      const updateId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint16", "uint256", "uint256", "uint256", "uint256"],
          [56, bscSupply.totalSupply, bscSupply.lockedSupply, bscSupply.circulatingSupply, Date.now()],
        ),
      );

      // Simulate multi-sig by having owner sign multiple times
      // In production, this would be different signers
      await supplyOracle
        .connect(vault)
        .submitSupplyUpdate(56, bscSupply.totalSupply, bscSupply.lockedSupply, bscSupply.circulatingSupply);
    });

    it("Should detect supply mismatches", async function () {
      // Configure tolerance
      await supplyOracle.connect(vault).updateReconciliationParams(
        15 * 60, // 15 minutes
        ethers.parseEther("1000"), // 1000 token tolerance
      );

      // This test would simulate a supply mismatch scenario
      // In production, the oracle would automatically pause bridges
    });
  });

  describe("Concurrent Operations Tests", function () {
    it("Should handle multiple simultaneous transfers", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);

      // Mint to multiple users
      const users = [user1, user2];
      const amount = ethers.parseEther("1000");

      for (const user of users) {
        await lookCoin.connect(vault).mint(user.address, amount);
        await lookCoin.connect(user).approve(celerIMModule.address, amount);
      }

      // Execute concurrent transfers
      const transfers = users.map((user) =>
        celerIMModule.connect(user).lockAndBridge(10, owner.address, amount, { value: ethers.parseEther("0.01") }),
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
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await lookCoin.connect(vault).grantRole(MINTER_ROLE, vault.address);

      const amount = ethers.parseEther("600000"); // Exceeds rate limit
      await lookCoin.connect(vault).mint(user1.address, amount);
      await lookCoin.connect(user1).approve(celerIMModule.address, amount);

      await expect(
        celerIMModule.connect(user1).lockAndBridge(10, user2.address, amount, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWith("RateLimiter: transfer amount exceeds limit");
    });
  });

  describe("Emergency Response Tests", function () {
    it("Should pause all bridges in emergency", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

      await lookCoin.connect(vault).grantRole(PAUSER_ROLE, vault.address);
      await celerIMModule.connect(vault).grantRole(OPERATOR_ROLE, vault.address);

      // Pause all contracts
      await lookCoin.connect(vault).pause();
      await celerIMModule.connect(vault).pause();

      // Verify all operations fail
      await expect(lookCoin.connect(user1).transfer(user2.address, 100)).to.be.revertedWith("Pausable: paused");

      await expect(celerIMModule.lockAndBridge(10, user2.address, 100, { value: 100 })).to.be.revertedWith(
        "Pausable: paused",
      );
    });
  });
});
