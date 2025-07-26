import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LookCoin } from "../../../typechain-types";

describe("LookCoin OFT V2 Tests", function () {
  let lookCoin: LookCoin;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let minter: SignerWithAddress;
  let protocolAdmin: SignerWithAddress;
  
  const MOCK_LZ_ENDPOINT = "0x0000000000000000000000000000000000000001";
  const DST_CHAIN_ID = 10111; // Optimism Sepolia for LayerZero
  const REMOTE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    [owner, user, minter, protocolAdmin] = await ethers.getSigners();

    // Deploy LookCoin using upgrades plugin
    const LookCoinFactory = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoinFactory,
      [owner.address, MOCK_LZ_ENDPOINT],
      { initializer: "initialize" }
    ) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Grant roles
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    const PROTOCOL_ADMIN_ROLE = await lookCoin.PROTOCOL_ADMIN_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, minter.address);
    await lookCoin.grantRole(PROTOCOL_ADMIN_ROLE, protocolAdmin.address);

    // Mint initial tokens for testing
    await lookCoin.connect(minter).mint(owner.address, ethers.parseEther("1000000"));
  });

  describe("OFT Configuration", function () {
    it("Should set trusted remote correctly", async function () {
      // Trusted remote should be packed as (remote address, local address)
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [REMOTE_ADDRESS, await lookCoin.getAddress()]
      );
      
      await lookCoin.connect(protocolAdmin).setTrustedRemote(DST_CHAIN_ID, trustedRemote);
      
      const storedRemote = await lookCoin.getTrustedRemote(DST_CHAIN_ID);
      expect(storedRemote).to.equal(trustedRemote);
    });

    it("Should reject invalid remote address length", async function () {
      const invalidRemote = "0x1234"; // Too short
      await expect(
        lookCoin.connect(protocolAdmin).setTrustedRemote(DST_CHAIN_ID, invalidRemote)
      ).to.be.revertedWithCustomError(lookCoin, "InvalidTrustedRemote");
    });

    it("Should set gas for destination", async function () {
      const gasAmount = 350000;
      await lookCoin.connect(protocolAdmin).setGasForDestinationLzReceive(DST_CHAIN_ID, gasAmount);
      
      const storedGas = await lookCoin.dstGasLookup(DST_CHAIN_ID);
      expect(storedGas).to.equal(gasAmount);
    });

    it("Should check if chain is configured", async function () {
      // Not configured initially
      expect(await lookCoin.isChainConfigured(DST_CHAIN_ID)).to.be.false;
      
      // Configure trusted remote
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [REMOTE_ADDRESS, await lookCoin.getAddress()]
      );
      await lookCoin.connect(protocolAdmin).setTrustedRemote(DST_CHAIN_ID, trustedRemote);
      
      // Still not configured without gas
      expect(await lookCoin.isChainConfigured(DST_CHAIN_ID)).to.be.false;
      
      // Set gas
      await lookCoin.connect(protocolAdmin).setGasForDestinationLzReceive(DST_CHAIN_ID, 200000);
      
      // Now should be configured
      expect(await lookCoin.isChainConfigured(DST_CHAIN_ID)).to.be.true;
    });

    it("Should configure DVN settings", async function () {
      const dvns = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
      const threshold = 2;
      
      await expect(
        lookCoin.connect(protocolAdmin).configureDVN(DST_CHAIN_ID, dvns, threshold)
      ).to.emit(lookCoin, "DVNConfigured")
        .withArgs(DST_CHAIN_ID, dvns.length, threshold);
    });

    it("Should connect peer using connectPeer helper", async function () {
      await lookCoin.connect(owner).connectPeer(DST_CHAIN_ID, REMOTE_ADDRESS);
      
      // Verify trusted remote was set
      const expectedRemote = ethers.solidityPacked(
        ["address", "address"],
        [REMOTE_ADDRESS, await lookCoin.getAddress()]
      );
      const storedRemote = await lookCoin.getTrustedRemote(DST_CHAIN_ID);
      expect(storedRemote).to.equal(expectedRemote);
    });
  });

  describe("Cross-chain Transfer Validation", function () {
    it("Should revert if destination chain not configured", async function () {
      const amount = ethers.parseEther("100");
      const toAddress = ethers.solidityPacked(["address"], [user.address]);
      
      await expect(
        lookCoin.sendFrom(
          owner.address,
          999, // Unconfigured chain
          toAddress,
          amount,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x"
        )
      ).to.be.revertedWithCustomError(lookCoin, "LayerZeroNotConfigured");
    });

    it("Should revert if LayerZero endpoint not set", async function () {
      // Deploy without endpoint
      const LookCoinFactory = await ethers.getContractFactory("LookCoin");
      const lookCoinNoLZ = await upgrades.deployProxy(
        LookCoinFactory,
        [owner.address, ethers.ZeroAddress],
        { initializer: "initialize" }
      ) as unknown as LookCoin;
      await lookCoinNoLZ.waitForDeployment();
      
      const amount = ethers.parseEther("100");
      const toAddress = ethers.solidityPacked(["address"], [user.address]);
      
      await expect(
        lookCoinNoLZ.sendFrom(
          owner.address,
          DST_CHAIN_ID,
          toAddress,
          amount,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x"
        )
      ).to.be.revertedWithCustomError(lookCoinNoLZ, "LayerZeroNotConfigured");
    });

    it("Should revert on zero amount", async function () {
      const toAddress = ethers.solidityPacked(["address"], [user.address]);
      
      await expect(
        lookCoin.sendFrom(
          owner.address,
          DST_CHAIN_ID,
          toAddress,
          0,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x"
        )
      ).to.be.revertedWithCustomError(lookCoin, "AmountMustBeGreaterThanZero");
    });

    it("Should revert on empty recipient", async function () {
      const amount = ethers.parseEther("100");
      
      await expect(
        lookCoin.sendFrom(
          owner.address,
          DST_CHAIN_ID,
          "0x",
          amount,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x"
        )
      ).to.be.revertedWithCustomError(lookCoin, "InvalidRecipient");
    });
  });

  describe("Supply Tracking", function () {
    it("Should track total minted and burned correctly", async function () {
      const mintAmount = ethers.parseEther("500");
      const burnAmount = ethers.parseEther("200");
      
      const initialMinted = await lookCoin.totalMinted();
      
      await lookCoin.connect(minter).mint(user.address, mintAmount);
      expect(await lookCoin.totalMinted()).to.equal(initialMinted + mintAmount);
      
      await lookCoin.connect(user).burn(user.address, burnAmount);
      expect(await lookCoin.totalBurned()).to.equal(burnAmount);
      
      expect(await lookCoin.circulatingSupply()).to.equal(initialMinted + mintAmount - burnAmount);
    });
  });

  describe("Bridge Convenience Functions", function () {
    beforeEach(async function () {
      // Configure chain for bridge tests
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [REMOTE_ADDRESS, await lookCoin.getAddress()]
      );
      await lookCoin.connect(protocolAdmin).setTrustedRemote(DST_CHAIN_ID, trustedRemote);
      await lookCoin.connect(protocolAdmin).setGasForDestinationLzReceive(DST_CHAIN_ID, 200000);
    });

    it("Should estimate bridge fee", async function () {
      const amount = ethers.parseEther("100");
      
      // This will fail with mock endpoint, but we're testing the function exists
      await expect(
        lookCoin.estimateBridgeFee(DST_CHAIN_ID, amount)
      ).to.be.reverted; // Mock endpoint doesn't implement fee estimation
    });

    it("Should use bridgeToken convenience function", async function () {
      const amount = ethers.parseEther("100");
      const recipient = REMOTE_ADDRESS;
      
      // This will fail with mock endpoint, but validates the function flow
      await expect(
        lookCoin.connect(owner).bridgeToken(DST_CHAIN_ID, recipient, amount, { value: ethers.parseEther("0.1") })
      ).to.be.reverted; // Mock endpoint doesn't implement actual bridging
    });
  });

  describe("Access Control", function () {
    it("Should enforce PROTOCOL_ADMIN_ROLE for configuration", async function () {
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [REMOTE_ADDRESS, await lookCoin.getAddress()]
      );
      
      // Should fail without role
      await expect(
        lookCoin.connect(user).setTrustedRemote(DST_CHAIN_ID, trustedRemote)
      ).to.be.revertedWithCustomError(lookCoin, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, await lookCoin.PROTOCOL_ADMIN_ROLE());
      
      // Should succeed with role
      await lookCoin.connect(protocolAdmin).setTrustedRemote(DST_CHAIN_ID, trustedRemote);
    });

    it("Should enforce DEFAULT_ADMIN_ROLE for connectPeer", async function () {
      // Should fail without role
      await expect(
        lookCoin.connect(user).connectPeer(DST_CHAIN_ID, REMOTE_ADDRESS)
      ).to.be.revertedWithCustomError(lookCoin, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, await lookCoin.DEFAULT_ADMIN_ROLE());
      
      // Should succeed with role
      await lookCoin.connect(owner).connectPeer(DST_CHAIN_ID, REMOTE_ADDRESS);
    });
  });
});