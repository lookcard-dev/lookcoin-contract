import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("IBCModule Test", function () {
  let lookCoin: any;
  let ibcModule: any;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let vault: any;

  beforeEach(async function () {
    [owner, addr1, addr2, vault] = await ethers.getSigners();
    
    // Deploy LookCoin
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin, 
      [owner.address, ethers.ZeroAddress],
      { initializer: 'initialize' }
    );
    await lookCoin.waitForDeployment();
    
    // Deploy IBCModule
    const IBCModule = await ethers.getContractFactory("IBCModule");
    ibcModule = await upgrades.deployProxy(
      IBCModule,
      [await lookCoin.getAddress(), vault.address, owner.address],
      { initializer: 'initialize' }
    );
    await ibcModule.waitForDeployment();
    
    // Grant MINTER_ROLE to IBC module
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, await ibcModule.getAddress());
    
    // Mint some tokens to addr1 for testing
    await lookCoin.grantRole(MINTER_ROLE, owner.address);
    await lookCoin.mint(addr1.address, ethers.parseEther("10000"));
  });

  it("Should have correct initialization", async function () {
    expect(await ibcModule.lookCoin()).to.equal(await lookCoin.getAddress());
    expect(await ibcModule.vaultAddress()).to.equal(vault.address);
    
    // Check IBC config
    const config = await ibcModule.ibcConfig();
    expect(config.channelId).to.equal("channel-0");
    expect(config.portId).to.equal("transfer");
    expect(config.minValidators).to.equal(21);
  });

  it("Should update validator set", async function () {
    // Create 21 validator addresses
    const validators = [];
    for (let i = 0; i < 21; i++) {
      validators.push(ethers.Wallet.createRandom().address);
    }
    
    const threshold = 14; // 2/3 of 21
    
    await ibcModule.updateValidatorSet(validators, threshold);
    
    // Check validators
    expect(await ibcModule.validators(0)).to.equal(validators[0]);
    expect(await ibcModule.validators(20)).to.equal(validators[20]);
    expect(await ibcModule.validatorThreshold()).to.equal(threshold);
    expect(await ibcModule.isValidator(validators[0])).to.be.true;
  });

  it("Should reject insufficient validators", async function () {
    const validators = [addr1.address, addr2.address]; // Only 2 validators
    
    await expect(
      ibcModule.updateValidatorSet(validators, 2)
    ).to.be.revertedWith("IBC: insufficient validators");
  });

  it("Should update IBC configuration", async function () {
    const newConfig = {
      channelId: "channel-1",
      portId: "transfer",
      timeoutHeight: 0,
      timeoutTimestamp: 7200,
      minValidators: 21,
      unbondingPeriod: 7 * 24 * 60 * 60
    };
    
    await ibcModule.updateIBCConfig(newConfig);
    
    const config = await ibcModule.ibcConfig();
    expect(config.channelId).to.equal("channel-1");
    expect(config.timeoutTimestamp).to.equal(7200);
  });

  it("Should update vault address", async function () {
    const newVault = addr2.address;
    
    await ibcModule.updateVaultAddress(newVault);
    expect(await ibcModule.vaultAddress()).to.equal(newVault);
  });

  it("Should create IBC packet correctly", async function () {
    const sender = addr1.address;
    const recipient = "akashic1234567890abcdef";
    const amount = ethers.parseEther("100");
    
    const packetData = await ibcModule.createIBCPacket(sender, recipient, amount);
    
    // Packet should be encoded
    expect(packetData).to.not.be.empty;
    expect(packetData.length).to.be.greaterThan(100);
  });

  it("Should handle role-based access control", async function () {
    const ADMIN_ROLE = await ibcModule.ADMIN_ROLE();
    const OPERATOR_ROLE = await ibcModule.OPERATOR_ROLE();
    const RELAYER_ROLE = await ibcModule.RELAYER_ROLE();
    
    // Check admin has correct roles
    expect(await ibcModule.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    expect(await ibcModule.hasRole(OPERATOR_ROLE, owner.address)).to.be.true;
    
    // Grant relayer role
    await ibcModule.grantRole(RELAYER_ROLE, addr1.address);
    expect(await ibcModule.hasRole(RELAYER_ROLE, addr1.address)).to.be.true;
  });

  it("Should handle pause functionality", async function () {
    // Pause the contract
    await ibcModule.pause();
    expect(await ibcModule.paused()).to.be.true;
    
    // Unpause
    await ibcModule.unpause();
    expect(await ibcModule.paused()).to.be.false;
  });
});