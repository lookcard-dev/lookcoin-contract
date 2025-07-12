import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("CelerIMModule Test", function () {
  let lookCoin: any;
  let celerModule: any;
  let mockMessageBus: any;
  let owner: any;
  let addr1: any;
  let addr2: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    
    // Deploy LookCoin
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin, 
      [owner.address, ethers.ZeroAddress],
      { initializer: 'initialize' }
    );
    await lookCoin.waitForDeployment();
    
    // Deploy MockMessageBus
    const MockMessageBus = await ethers.getContractFactory("MockMessageBus");
    mockMessageBus = await MockMessageBus.deploy();
    await mockMessageBus.waitForDeployment();
    
    // Configure mock fees
    await mockMessageBus.setFeeParams(ethers.parseEther("0.001"), 1000);
    
    // Deploy CelerIMModule
    const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
    celerModule = await upgrades.deployProxy(
      CelerIMModule,
      [await mockMessageBus.getAddress(), await lookCoin.getAddress(), owner.address],
      { initializer: 'initialize' }
    );
    await celerModule.waitForDeployment();
    
    // Grant MINTER_ROLE to CelerIM module
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, await celerModule.getAddress());
    
    // Mint some tokens to addr1 for testing
    await lookCoin.grantRole(MINTER_ROLE, owner.address);
    await lookCoin.mint(addr1.address, ethers.parseEther("10000"));
  });

  it("Should have correct initialization", async function () {
    expect(await celerModule.lookCoin()).to.equal(await lookCoin.getAddress());
    expect(await celerModule.messageBus()).to.equal(await mockMessageBus.getAddress());
  });

  it("Should set remote modules correctly", async function () {
    const BSC_CHAINID = 56;
    const OPTIMISM_CHAINID = 10;
    
    await celerModule.setRemoteModule(BSC_CHAINID, addr2.address);
    await celerModule.setRemoteModule(OPTIMISM_CHAINID, owner.address);
    
    expect(await celerModule.remoteModules(BSC_CHAINID)).to.equal(addr2.address);
    expect(await celerModule.remoteModules(OPTIMISM_CHAINID)).to.equal(owner.address);
  });

  it("Should calculate fees correctly", async function () {
    const amount = ethers.parseEther("1000");
    const fee = await celerModule.calculateFee(amount);
    
    // Default fee is 0.5% (50 basis points), but minimum fee is 10 LOOK
    const calculatedFee = (amount * 50n) / 10000n; // 5 LOOK
    const minFee = await celerModule.minFee(); // Should be 10 LOOK
    const expectedFee = calculatedFee < minFee ? minFee : calculatedFee;
    expect(fee).to.equal(expectedFee);
  });

  it("Should estimate message fees", async function () {
    const message = ethers.toUtf8Bytes("test message");
    const fee = await celerModule.estimateMessageFee(56, message);
    
    // Base fee + per byte fee
    const expectedFee = ethers.parseEther("0.001") + BigInt(message.length * 1000);
    expect(fee).to.equal(expectedFee);
  });

  it("Should handle fee parameter updates", async function () {
    const newFeePercentage = 100; // 1%
    const newMinFee = ethers.parseEther("5");
    const newMaxFee = ethers.parseEther("500");
    
    await celerModule.updateFeeParameters(newFeePercentage, newMinFee, newMaxFee);
    
    // Test with small amount (should use min fee)
    const smallAmount = ethers.parseEther("100");
    expect(await celerModule.calculateFee(smallAmount)).to.equal(newMinFee);
    
    // Test with large amount (should use max fee)
    const largeAmount = ethers.parseEther("100000");
    expect(await celerModule.calculateFee(largeAmount)).to.equal(newMaxFee);
  });

  it("Should handle whitelist and blacklist", async function () {
    // Add to whitelist
    await celerModule.updateWhitelist(addr1.address, true);
    expect(await celerModule.whitelist(addr1.address)).to.be.true;
    
    // Add to blacklist
    await celerModule.updateBlacklist(addr2.address, true);
    expect(await celerModule.blacklist(addr2.address)).to.be.true;
  });

  it("Should reject blacklisted users", async function () {
    // Setup remote module
    await celerModule.setRemoteModule(10, addr2.address);
    
    // Blacklist addr1
    await celerModule.updateBlacklist(addr1.address, true);
    
    // Approve tokens
    await lookCoin.connect(addr1).approve(await celerModule.getAddress(), ethers.parseEther("100"));
    
    // Should fail
    await expect(
      celerModule.connect(addr1).lockAndBridge(
        10,
        addr2.address,
        ethers.parseEther("100"),
        { value: ethers.parseEther("0.1") }
      )
    ).to.be.revertedWith("CelerIM: sender blacklisted");
  });
});