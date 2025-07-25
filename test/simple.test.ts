import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("Simple LookCoin Test", function () {
  let lookCoin: any;
  let owner: any;
  let addr1: any;
  let addr2: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy LookCoin as upgradeable
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(LookCoin, [owner.address, ethers.ZeroAddress], { initializer: "initialize" });
    await lookCoin.waitForDeployment();
  });

  it("Should have correct token metadata", async function () {
    expect(await lookCoin.name()).to.equal("LookCoin");
    expect(await lookCoin.symbol()).to.equal("LOOK");
    expect(await lookCoin.decimals()).to.equal(18);
  });

  it("Should set up roles correctly", async function () {
    const DEFAULT_ADMIN_ROLE = await lookCoin.DEFAULT_ADMIN_ROLE();
    const PAUSER_ROLE = await lookCoin.PAUSER_ROLE();
    const UPGRADER_ROLE = await lookCoin.UPGRADER_ROLE();

    expect(await lookCoin.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    expect(await lookCoin.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
    expect(await lookCoin.hasRole(UPGRADER_ROLE, owner.address)).to.be.true;
  });

  it("Should handle minting with proper roles", async function () {
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();

    // Grant minter role to addr1
    await lookCoin.grantRole(MINTER_ROLE, addr1.address);

    // Mint tokens
    await lookCoin.connect(addr1).mint(addr2.address, ethers.parseEther("1000"));

    expect(await lookCoin.balanceOf(addr2.address)).to.equal(ethers.parseEther("1000"));
    expect(await lookCoin.totalMinted()).to.equal(ethers.parseEther("1000"));
    expect(await lookCoin.totalSupply()).to.equal(ethers.parseEther("1000"));
  });

  it("Should enforce rate limiting", async function () {
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, addr1.address);

    const maxAmount = await lookCoin.maxTransferPerWindow();

    // First mint should succeed
    await lookCoin.connect(addr1).mint(addr2.address, maxAmount);

    // Second mint within window should fail
    await expect(lookCoin.connect(addr1).mint(addr2.address, ethers.parseEther("1"))).to.be.revertedWith(
      "LookCoin: user transfer limit exceeded",
    );
  });

  it("Should handle pause/unpause functionality", async function () {
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, addr1.address);

    // Pause the contract
    await lookCoin.pause();

    // Operations should fail when paused
    await expect(lookCoin.connect(addr1).mint(addr2.address, ethers.parseEther("100"))).to.be.revertedWithCustomError(
      lookCoin,
      "EnforcedPause",
    );

    // Unpause
    await lookCoin.unpause();

    // Operations should succeed after unpause
    await lookCoin.connect(addr1).mint(addr2.address, ethers.parseEther("100"));
    expect(await lookCoin.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
  });
});
