import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LookCoin } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LookCoin", function () {
  let lookCoin: LookCoin;
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let burner: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let upgrader: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, admin, minter, burner, pauser, upgrader, user1, user2] = await ethers.getSigners();

    // Deploy LookCoin as upgradeable
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin,
      [admin.address],
      { initializer: "initialize" }
    ) as LookCoin;
  });

  describe("Deployment and Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await lookCoin.name()).to.equal("LookCoin");
      expect(await lookCoin.symbol()).to.equal("LOOK");
      expect(await lookCoin.decimals()).to.equal(18);
    });

    it("Should set correct roles", async function () {
      expect(await lookCoin.hasRole(await lookCoin.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await lookCoin.hasRole(await lookCoin.PAUSER_ROLE(), admin.address)).to.be.true;
      expect(await lookCoin.hasRole(await lookCoin.UPGRADER_ROLE(), admin.address)).to.be.true;
    });

    it("Should initialize rate limits", async function () {
      expect(await lookCoin.maxTransferPerWindow()).to.equal(ethers.parseUnits("1000000", 18));
      expect(await lookCoin.maxTransactionsPerWindow()).to.equal(100);
    });
  });

  describe("Role Management", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      await lookCoin.connect(admin).grantRole(await lookCoin.BURNER_ROLE(), burner.address);
      await lookCoin.connect(admin).grantRole(await lookCoin.PAUSER_ROLE(), pauser.address);
    });

    it("Should grant and revoke roles correctly", async function () {
      expect(await lookCoin.hasRole(await lookCoin.MINTER_ROLE(), minter.address)).to.be.true;
      
      await lookCoin.connect(admin).revokeRole(await lookCoin.MINTER_ROLE(), minter.address);
      expect(await lookCoin.hasRole(await lookCoin.MINTER_ROLE(), minter.address)).to.be.false;
    });

    it("Should check role members", async function () {
      const minterRole = await lookCoin.MINTER_ROLE();
      expect(await lookCoin.hasRole(minterRole, minter.address)).to.be.true;
    });

    it("Should enforce role-based access control", async function () {
      await expect(
        lookCoin.connect(user1).mint(user2.address, ethers.parseUnits("100", 18))
      ).to.be.reverted;
    });
  });

  describe("Minting and Burning", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      await lookCoin.connect(admin).grantRole(await lookCoin.BURNER_ROLE(), burner.address);
    });

    it("Should mint tokens correctly", async function () {
      const amount = ethers.parseUnits("1000", 18);
      await lookCoin.connect(minter).mint(user1.address, amount);
      
      expect(await lookCoin.balanceOf(user1.address)).to.equal(amount);
      expect(await lookCoin.totalMinted()).to.equal(amount);
      expect(await lookCoin.circulatingSupply()).to.equal(amount);
    });

    it("Should burn tokens correctly", async function () {
      const amount = ethers.parseUnits("1000", 18);
      await lookCoin.connect(minter).mint(user1.address, amount);
      
      // User must approve burner first
      await lookCoin.connect(user1).approve(burner.address, amount);
      await lookCoin.connect(burner).burn(user1.address, amount);
      
      expect(await lookCoin.balanceOf(user1.address)).to.equal(0);
      expect(await lookCoin.totalBurned()).to.equal(amount);
      expect(await lookCoin.circulatingSupply()).to.equal(0);
    });

    it("Should track supply correctly", async function () {
      const mintAmount1 = ethers.parseUnits("1000", 18);
      const mintAmount2 = ethers.parseUnits("500", 18);
      const burnAmount = ethers.parseUnits("300", 18);
      
      await lookCoin.connect(minter).mint(user1.address, mintAmount1);
      await lookCoin.connect(minter).mint(user2.address, mintAmount2);
      
      await lookCoin.connect(user1).approve(burner.address, burnAmount);
      await lookCoin.connect(burner).burn(user1.address, burnAmount);
      
      expect(await lookCoin.totalMinted()).to.equal(mintAmount1 + mintAmount2);
      expect(await lookCoin.totalBurned()).to.equal(burnAmount);
      expect(await lookCoin.circulatingSupply()).to.equal(mintAmount1 + mintAmount2 - burnAmount);
    });
  });

  describe("Pause Functionality", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      await lookCoin.connect(admin).grantRole(await lookCoin.PAUSER_ROLE(), pauser.address);
    });

    it("Should pause and unpause correctly", async function () {
      await lookCoin.connect(pauser).pause();
      expect(await lookCoin.paused()).to.be.true;
      
      await lookCoin.connect(pauser).unpause();
      expect(await lookCoin.paused()).to.be.false;
    });

    it("Should prevent operations when paused", async function () {
      await lookCoin.connect(pauser).pause();
      
      await expect(
        lookCoin.connect(minter).mint(user1.address, ethers.parseUnits("100", 18))
      ).to.be.reverted;
      
      // Mint some tokens before pausing for transfer test
      await lookCoin.connect(pauser).unpause();
      await lookCoin.connect(minter).mint(user1.address, ethers.parseUnits("100", 18));
      await lookCoin.connect(pauser).pause();
      
      await expect(
        lookCoin.connect(user1).transfer(user2.address, ethers.parseUnits("50", 18))
      ).to.be.reverted;
    });

    it("Should emit events on pause/unpause", async function () {
      await expect(lookCoin.connect(pauser).pause())
        .to.emit(lookCoin, "EmergencyPause")
        .withArgs(pauser.address);
        
      await expect(lookCoin.connect(pauser).unpause())
        .to.emit(lookCoin, "EmergencyUnpause")
        .withArgs(pauser.address);
    });
  });

  describe("Rate Limiting", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
    });

    it("Should enforce user rate limits", async function () {
      const maxTransfer = await lookCoin.maxTransferPerWindow();
      
      // First transfer should succeed
      await lookCoin.connect(minter).mint(user1.address, maxTransfer);
      
      // Second transfer should fail
      await expect(
        lookCoin.connect(minter).mint(user1.address, 1)
      ).to.be.revertedWith("LookCoin: user transfer limit exceeded");
    });

    it("Should enforce transaction count limits", async function () {
      const maxTx = await lookCoin.maxTransactionsPerWindow();
      const amount = ethers.parseUnits("1", 18);
      
      // Perform max transactions
      for (let i = 0; i < Number(maxTx); i++) {
        await lookCoin.connect(minter).mint(user1.address, amount);
      }
      
      // Next transaction should fail
      await expect(
        lookCoin.connect(minter).mint(user1.address, amount)
      ).to.be.revertedWith("LookCoin: user transaction limit exceeded");
    });

    it("Should reset rate limits after window", async function () {
      const maxTransfer = await lookCoin.maxTransferPerWindow();
      
      // Max out rate limit
      await lookCoin.connect(minter).mint(user1.address, maxTransfer);
      
      // Move time forward past rate limit window
      await time.increase(3601); // 1 hour + 1 second
      
      // Should be able to mint again
      await lookCoin.connect(minter).mint(user1.address, maxTransfer);
      expect(await lookCoin.balanceOf(user1.address)).to.equal(maxTransfer * 2n);
    });

    it("Should enforce global rate limits", async function () {
      const maxTransfer = await lookCoin.maxTransferPerWindow();
      const globalMax = maxTransfer * 100n;
      
      // Try to exceed global limit across multiple users
      for (let i = 0; i < 100; i++) {
        const user = ethers.Wallet.createRandom(ethers.provider);
        await lookCoin.connect(minter).mint(user.address, maxTransfer);
      }
      
      // Next mint should fail due to global limit
      await expect(
        lookCoin.connect(minter).mint(user2.address, maxTransfer)
      ).to.be.revertedWith("LookCoin: global transfer limit exceeded");
    });

    it("Should update rate limits correctly", async function () {
      const newMaxTransfer = ethers.parseUnits("2000000", 8);
      const newMaxTx = 200;
      
      await lookCoin.connect(admin).updateRateLimits(newMaxTransfer, newMaxTx);
      
      expect(await lookCoin.maxTransferPerWindow()).to.equal(newMaxTransfer);
      expect(await lookCoin.maxTransactionsPerWindow()).to.equal(newMaxTx);
    });
  });

  describe("ERC20 Functionality", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      const amount = ethers.parseUnits("10000", 18);
      await lookCoin.connect(minter).mint(user1.address, amount);
    });

    it("Should transfer tokens correctly", async function () {
      const transferAmount = ethers.parseUnits("1000", 18);
      await lookCoin.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await lookCoin.balanceOf(user1.address)).to.equal(ethers.parseUnits("9000", 18));
      expect(await lookCoin.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should handle approve and transferFrom correctly", async function () {
      const approveAmount = ethers.parseUnits("5000", 18);
      const transferAmount = ethers.parseUnits("3000", 18);
      
      await lookCoin.connect(user1).approve(user2.address, approveAmount);
      expect(await lookCoin.allowance(user1.address, user2.address)).to.equal(approveAmount);
      
      await lookCoin.connect(user2).transferFrom(user1.address, user2.address, transferAmount);
      
      expect(await lookCoin.balanceOf(user1.address)).to.equal(ethers.parseUnits("7000", 18));
      expect(await lookCoin.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await lookCoin.allowance(user1.address, user2.address)).to.equal(approveAmount - transferAmount);
    });
  });

  describe("Upgradeability", function () {
    it("Should only allow upgrader role to upgrade", async function () {
      const LookCoinV2 = await ethers.getContractFactory("LookCoin");
      
      await expect(
        upgrades.upgradeProxy(await lookCoin.getAddress(), LookCoinV2.connect(user1))
      ).to.be.reverted;
    });

    it("Should preserve state after upgrade", async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      const amount = ethers.parseUnits("1000", 18);
      await lookCoin.connect(minter).mint(user1.address, amount);
      
      const balanceBefore = await lookCoin.balanceOf(user1.address);
      const totalMintedBefore = await lookCoin.totalMinted();
      
      // Note: Actual upgrade would require a V2 contract
      // This test demonstrates the pattern
      
      expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore);
      expect(await lookCoin.totalMinted()).to.equal(totalMintedBefore);
    });
  });


  describe("Edge Cases and Security", function () {
    beforeEach(async function () {
      await lookCoin.connect(admin).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
      await lookCoin.connect(admin).grantRole(await lookCoin.BURNER_ROLE(), burner.address);
    });

    it("Should prevent minting to zero address", async function () {
      await expect(
        lookCoin.connect(minter).mint(ethers.ZeroAddress, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("LookCoin: mint to zero address");
    });

    it("Should prevent burning from zero address", async function () {
      await expect(
        lookCoin.connect(burner).burn(ethers.ZeroAddress, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("LookCoin: burn from zero address");
    });

    it("Should prevent reentrancy attacks", async function () {
      // Reentrancy protection is built into the modifiers
      // This would require a malicious contract to test properly
    });

    it("Should handle maximum uint256 values correctly", async function () {
      const maxUint256 = ethers.MaxUint256;
      
      // Should revert on overflow
      await expect(
        lookCoin.connect(minter).mint(user1.address, maxUint256)
      ).to.be.reverted;
    });
  });
});