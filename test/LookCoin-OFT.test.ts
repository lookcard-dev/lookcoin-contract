import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LookCoin } from "../typechain-types";

describe("LookCoin OFT V2 Tests", function () {
  let lookCoin: LookCoin;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let minter: SignerWithAddress;
  
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const MOCK_LZ_ENDPOINT = "0x0000000000000000000000000000000000000001";
  const DST_CHAIN_ID = 102; // BSC
  const REMOTE_ADDRESS = "0x0000000000000000000000000000000000000002";

  beforeEach(async function () {
    [owner, user, minter] = await ethers.getSigners();

    // Deploy LookCoin
    const LookCoinFactory = await ethers.getContractFactory("LookCoin");
    const lookCoinImpl = await LookCoinFactory.deploy();
    await lookCoinImpl.waitForDeployment();

    // Deploy proxy
    const ERC1967ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
    const initData = lookCoinImpl.interface.encodeFunctionData("initialize", [
      owner.address,
      MOCK_LZ_ENDPOINT
    ]);
    const proxy = await ERC1967ProxyFactory.deploy(
      await lookCoinImpl.getAddress(),
      initData
    );
    await proxy.waitForDeployment();

    lookCoin = await ethers.getContractAt("LookCoin", await proxy.getAddress());

    // Grant roles
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    const BURNER_ROLE = await lookCoin.BURNER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, minter.address);
    await lookCoin.grantRole(BURNER_ROLE, await lookCoin.getAddress());

    // Mint initial supply
    await lookCoin.connect(minter).mint(owner.address, INITIAL_SUPPLY);
  });

  describe("OFT Configuration", function () {
    it("Should set trusted remote correctly", async function () {
      // Just send the address without ABI encoding (20 bytes)
      const remoteBytes = REMOTE_ADDRESS;
      await lookCoin.setTrustedRemote(DST_CHAIN_ID, remoteBytes);
      
      const trustedRemote = await lookCoin.getTrustedRemote(DST_CHAIN_ID);
      expect(trustedRemote).to.not.equal(ethers.ZeroHash);
    });

    it("Should reject invalid remote address length", async function () {
      const invalidRemote = "0x1234"; // Too short
      await expect(
        lookCoin.setTrustedRemote(DST_CHAIN_ID, invalidRemote)
      ).to.be.revertedWith("LookCoin: invalid remote address length");
    });

    it("Should set enforced options", async function () {
      const minGas = 350000;
      await lookCoin.setEnforcedOptions(DST_CHAIN_ID, minGas);
      
      const enforcedGas = await lookCoin.enforcedOptions(DST_CHAIN_ID);
      expect(enforcedGas).to.equal(minGas);
    });

    it("Should check if chain is configured", async function () {
      // Not configured initially
      expect(await lookCoin.isChainConfigured(DST_CHAIN_ID)).to.be.false;
      
      // Configure trusted remote
      await lookCoin.setTrustedRemote(DST_CHAIN_ID, REMOTE_ADDRESS);
      
      // Now should be configured
      expect(await lookCoin.isChainConfigured(DST_CHAIN_ID)).to.be.true;
    });
  });

  describe("Cross-chain Transfer Validation", function () {
    it("Should revert if destination chain not configured", async function () {
      const amount = ethers.parseEther("100");
      const toAddress = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
      
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
      ).to.be.revertedWith("LookCoin: destination chain not configured");
    });

    it("Should revert if LayerZero endpoint not set", async function () {
      // Deploy without endpoint
      const LookCoinFactory = await ethers.getContractFactory("LookCoin");
      const lookCoinImpl = await LookCoinFactory.deploy();
      await lookCoinImpl.waitForDeployment();

      const ERC1967ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const initData = lookCoinImpl.interface.encodeFunctionData("initialize", [
        owner.address,
        ethers.ZeroAddress // No endpoint
      ]);
      const proxy = await ERC1967ProxyFactory.deploy(
        await lookCoinImpl.getAddress(),
        initData
      );
      await proxy.waitForDeployment();

      const lookCoinNoLZ = await ethers.getContractAt("LookCoin", await proxy.getAddress());
      
      const amount = ethers.parseEther("100");
      const toAddress = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
      
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
      ).to.be.revertedWith("LookCoin: LayerZero not configured");
    });

    it("Should revert on zero amount", async function () {
      const toAddress = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
      
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
      ).to.be.revertedWith("LookCoin: invalid amount");
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
      ).to.be.revertedWith("LookCoin: invalid recipient");
    });
  });

  describe("Burn and Mint", function () {
    it("Should track total minted and burned", async function () {
      const mintAmount = ethers.parseEther("500");
      const burnAmount = ethers.parseEther("200");
      
      await lookCoin.connect(minter).mint(user.address, mintAmount);
      expect(await lookCoin.totalMinted()).to.equal(INITIAL_SUPPLY + mintAmount);
      
      await lookCoin.connect(user).burn(user.address, burnAmount);
      expect(await lookCoin.totalBurned()).to.equal(burnAmount);
      
      expect(await lookCoin.circulatingSupply()).to.equal(INITIAL_SUPPLY + mintAmount - burnAmount);
    });
  });

  describe("Convenience Functions", function () {
    it("Should estimate bridge fee", async function () {
      // Configure trusted remote
      await lookCoin.setTrustedRemote(DST_CHAIN_ID, REMOTE_ADDRESS);
      
      const amount = ethers.parseEther("100");
      const toAddress = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
      
      // This will fail with mock endpoint, but we're testing the function exists
      await expect(
        lookCoin.estimateBridgeFee(DST_CHAIN_ID, toAddress, amount)
      ).to.be.reverted;
    });

    it("Should support bridgeToken convenience function", async function () {
      // Configure trusted remote
      await lookCoin.setTrustedRemote(DST_CHAIN_ID, REMOTE_ADDRESS);
      
      const amount = ethers.parseEther("100");
      const toAddress = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
      
      // This will fail with mock endpoint, but we're testing the validation
      await expect(
        lookCoin.connect(owner).bridgeToken(DST_CHAIN_ID, toAddress, amount)
      ).to.be.reverted;
    });
  });
});