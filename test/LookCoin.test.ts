import { expect } from "chai";
import { ethers, ignition } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import LookCoinModule from "../ignition/modules/LookCoinModule";
import MocksModule from "../ignition/modules/MocksModule";

describe("LookCoin", function () {
  let lookCoin: any;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let mockEndpoint: any;

  beforeEach(async function () {
    [owner, addr1, addr2, minter, burner] = await ethers.getSigners();

    // Deploy mocks first
    const mocks = await ignition.deploy(MocksModule);
    mockEndpoint = mocks.mockLayerZeroEndpoint;

    // Deploy LookCoin with mock endpoint
    const deployment = await ignition.deploy(LookCoinModule, {
      parameters: {
        LookCoinModule: {
          admin: owner.address,
          lzEndpoint: await mockEndpoint.getAddress(),
          totalSupply: ethers.parseEther("1000000000"),
          chainId: 56,
        },
      },
    });

    lookCoin = deployment.lookCoin;

    // Grant roles
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    await lookCoin.grantRole(MINTER_ROLE, minter.address);
    await lookCoin.grantRole(BURNER_ROLE, burner.address);
  });

  describe("Core Token Tests", function () {
    it("Should have correct token metadata", async function () {
      expect(await lookCoin.name()).to.equal("LookCoin");
      expect(await lookCoin.symbol()).to.equal("LOOK");
      expect(await lookCoin.decimals()).to.equal(18);
    });

    it("Should handle transfers correctly", async function () {
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      
      await lookCoin.connect(addr1).transfer(addr2.address, ethers.parseEther("100"));
      expect(await lookCoin.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(ethers.parseEther("900"));
    });

    it("Should track total supply correctly", async function () {
      expect(await lookCoin.totalSupply()).to.equal(0);
      
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      expect(await lookCoin.totalSupply()).to.equal(ethers.parseEther("1000"));
      expect(await lookCoin.totalMinted()).to.equal(ethers.parseEther("1000"));
      
      await lookCoin.connect(burner).burn(addr1.address, ethers.parseEther("300"));
      expect(await lookCoin.totalSupply()).to.equal(ethers.parseEther("700"));
      expect(await lookCoin.totalBurned()).to.equal(ethers.parseEther("300"));
      expect(await lookCoin.circulatingSupply()).to.equal(ethers.parseEther("700"));
    });
  });

  describe("LayerZero Integration Tests", function () {
    it("Should configure DVN settings", async function () {
      const dvns = [addr1.address, addr2.address, owner.address];
      await lookCoin.configureDVN(dvns, 2, 1, 66);
      
      // Verify event emission
      const filter = lookCoin.filters.DVNConfigured();
      const events = await lookCoin.queryFilter(filter);
      expect(events.length).to.be.greaterThan(0);
    });

    it("Should connect peer contracts", async function () {
      const dstChainId = 10; // Optimism
      const peerAddress = ethers.zeroPadValue(addr1.address, 32);
      
      await lookCoin.connectPeer(dstChainId, peerAddress);
      
      // Verify event emission
      const filter = lookCoin.filters.PeerConnected();
      const events = await lookCoin.queryFilter(filter);
      expect(events.length).to.be.greaterThan(0);
      expect(events[0].args[0]).to.equal(dstChainId);
    });
  });

  describe("Access Control Tests", function () {
    it("Should enforce role-based access for minting", async function () {
      await expect(
        lookCoin.connect(addr1).mint(addr1.address, ethers.parseEther("1000"))
      ).to.be.reverted;
      
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should enforce role-based access for burning", async function () {
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      
      await expect(
        lookCoin.connect(addr1).burn(addr1.address, ethers.parseEther("100"))
      ).to.be.reverted;
      
      await lookCoin.connect(burner).burn(addr1.address, ethers.parseEther("100"));
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(ethers.parseEther("900"));
    });
  });

  describe("Rate Limiting Tests", function () {
    it("Should enforce rate limits on minting", async function () {
      const maxAmount = ethers.parseEther("500000");
      
      // First mint should succeed
      await lookCoin.connect(minter).mint(addr1.address, maxAmount);
      
      // Second mint within window should fail
      await expect(
        lookCoin.connect(minter).mint(addr1.address, maxAmount)
      ).to.be.revertedWith("LookCoin: user transfer limit exceeded");
    });

    it("Should reset rate limits after window expires", async function () {
      const amount = ethers.parseEther("500000");
      
      await lookCoin.connect(minter).mint(addr1.address, amount);
      
      // Fast forward time by 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);
      
      // Should be able to mint again
      await lookCoin.connect(minter).mint(addr1.address, amount);
    });
  });

  describe("Security Tests", function () {
    it("Should pause and unpause operations", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      await lookCoin.grantRole(PAUSER_ROLE, owner.address);
      
      await lookCoin.pause();
      expect(await lookCoin.paused()).to.be.true;
      
      // Operations should fail when paused
      await expect(
        lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"))
      ).to.be.revertedWith("Pausable: paused");
      
      await lookCoin.unpause();
      expect(await lookCoin.paused()).to.be.false;
      
      // Operations should succeed after unpause
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
    });

    it("Should prevent zero address operations", async function () {
      await expect(
        lookCoin.connect(minter).mint(ethers.ZeroAddress, ethers.parseEther("1000"))
      ).to.be.revertedWith("LookCoin: mint to zero address");
      
      await expect(
        lookCoin.connect(burner).burn(ethers.ZeroAddress, ethers.parseEther("1000"))
      ).to.be.revertedWith("LookCoin: burn from zero address");
    });
  });

  describe("Upgrade Tests", function () {
    it("Should only allow upgrader role to upgrade", async function () {
      const UPGRADER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));
      
      // Deploy new implementation
      const LookCoinV2 = await ethers.getContractFactory("LookCoin");
      const lookCoinV2 = await LookCoinV2.deploy();
      
      // Non-upgrader should fail
      await expect(
        lookCoin.connect(addr1).upgradeTo(await lookCoinV2.getAddress())
      ).to.be.reverted;
      
      // Upgrader should succeed
      await lookCoin.grantRole(UPGRADER_ROLE, owner.address);
      await lookCoin.upgradeTo(await lookCoinV2.getAddress());
    });
  });
});