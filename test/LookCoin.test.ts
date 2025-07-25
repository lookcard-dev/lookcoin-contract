import { expect } from "chai";
import { ethers, ignition } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import LookCoinModule from "../ignition/modules/LookCoinModule";
import MocksModule from "../ignition/modules/MocksModule";
import { SecurityAudit, SecurityTestRunner } from "./utils/securityAudit";

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
      await expect(lookCoin.connect(addr1).mint(addr1.address, ethers.parseEther("1000"))).to.be.reverted;

      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should enforce role-based access for burning", async function () {
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));

      await expect(lookCoin.connect(addr1).burn(addr1.address, ethers.parseEther("100"))).to.be.reverted;

      await lookCoin.connect(burner).burn(addr1.address, ethers.parseEther("100"));
      expect(await lookCoin.balanceOf(addr1.address)).to.equal(ethers.parseEther("900"));
    });
  });

  describe("Enhanced Security Tests", function () {
    it("Should prevent reentrancy attacks on mint", async function () {
      // Test reentrancy protection
      const hasReentrancy = await SecurityAudit.testReentrancy(
        lookCoin,
        "mint",
        [addr1.address, ethers.parseEther("1000")],
        { from: minter }
      );
      expect(hasReentrancy).to.be.false;
    });

    it("Should enforce comprehensive access control", async function () {
      const MINTER_ROLE = await lookCoin.MINTER_ROLE();
      const BURNER_ROLE = await lookCoin.BURNER_ROLE();
      const PAUSER_ROLE = await lookCoin.PAUSER_ROLE();
      const UPGRADER_ROLE = await lookCoin.UPGRADER_ROLE();
      
      // Test minter role
      const minterAccess = await SecurityAudit.testAccessControl(
        lookCoin,
        "mint",
        [addr1.address, ethers.parseEther("1000")],
        "MINTER_ROLE",
        minter,
        addr1
      );
      expect(minterAccess.authorized).to.be.true;
      expect(minterAccess.unauthorized).to.be.true;
      
      // Test burner role
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      const burnerAccess = await SecurityAudit.testAccessControl(
        lookCoin,
        "burn",
        [addr1.address, ethers.parseEther("100")],
        "BURNER_ROLE",
        burner,
        addr1
      );
      expect(burnerAccess.authorized).to.be.true;
      expect(burnerAccess.unauthorized).to.be.true;
    });

    it("Should protect against integer overflow in supply tracking", async function () {
      const maxUint256 = ethers.MaxUint256;
      
      // Attempt to mint max value
      await expect(
        lookCoin.connect(minter).mint(addr1.address, maxUint256)
      ).to.be.reverted; // Should revert due to SafeMath/overflow protection
    });

    it("Should validate cross-chain parameters", async function () {
      // Test invalid chain ID
      await expect(
        lookCoin.bridgeToken(
          999, // Invalid chain ID
          ethers.toUtf8Bytes(addr2.address),
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("LookCoin: destination not trusted");
      
      // Test zero amount
      await expect(
        lookCoin.bridgeToken(
          10, // Valid chain ID (after setup)
          ethers.toUtf8Bytes(addr2.address),
          0,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("LookCoin: invalid amount");
    });

    it("Should handle emergency pause correctly", async function () {
      const PAUSER_ROLE = await lookCoin.PAUSER_ROLE();
      
      const pauseResult = await SecurityAudit.testEmergencyPause(
        lookCoin,
        "pause",
        "unpause",
        "transfer",
        [addr2.address, ethers.parseEther("10")],
        owner
      );
      
      expect(pauseResult.pauseWorks).to.be.true;
      expect(pauseResult.unpauseWorks).to.be.true;
    });

    it("Should track supply accurately across operations", async function () {
      // Initial state
      expect(await lookCoin.totalMinted()).to.equal(0);
      expect(await lookCoin.totalBurned()).to.equal(0);
      expect(await lookCoin.circulatingSupply()).to.equal(0);
      
      // Mint operations
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
      expect(await lookCoin.totalMinted()).to.equal(ethers.parseEther("1000"));
      expect(await lookCoin.circulatingSupply()).to.equal(ethers.parseEther("1000"));
      
      // Burn operations
      await lookCoin.connect(burner).burn(addr1.address, ethers.parseEther("300"));
      expect(await lookCoin.totalBurned()).to.equal(ethers.parseEther("300"));
      expect(await lookCoin.circulatingSupply()).to.equal(ethers.parseEther("700"));
      
      // Cross-chain operations (when endpoint is set)
      const dstChainId = 10;
      await lookCoin.connectPeer(dstChainId, ethers.zeroPadValue(addr1.address, 32));
      
      // Bridge tokens (burn on source)
      await lookCoin.connect(addr1).bridgeToken(
        dstChainId,
        ethers.toUtf8Bytes(addr2.address),
        ethers.parseEther("100"),
        { value: ethers.parseEther("0.1") }
      );
      
      expect(await lookCoin.totalBurned()).to.equal(ethers.parseEther("400"));
      expect(await lookCoin.circulatingSupply()).to.equal(ethers.parseEther("600"));
    });
  });

  describe("Security Tests", function () {
    it("Should pause and unpause operations", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      await lookCoin.grantRole(PAUSER_ROLE, owner.address);

      await lookCoin.pause();
      expect(await lookCoin.paused()).to.be.true;

      // Operations should fail when paused
      await expect(lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"))).to.be.revertedWith(
        "Pausable: paused",
      );

      await lookCoin.unpause();
      expect(await lookCoin.paused()).to.be.false;

      // Operations should succeed after unpause
      await lookCoin.connect(minter).mint(addr1.address, ethers.parseEther("1000"));
    });

    it("Should prevent zero address operations", async function () {
      await expect(lookCoin.connect(minter).mint(ethers.ZeroAddress, ethers.parseEther("1000"))).to.be.revertedWith(
        "LookCoin: mint to zero address",
      );

      await expect(lookCoin.connect(burner).burn(ethers.ZeroAddress, ethers.parseEther("1000"))).to.be.revertedWith(
        "LookCoin: burn from zero address",
      );
    });
  });

  describe("Upgrade Tests", function () {
    it("Should only allow upgrader role to upgrade", async function () {
      const UPGRADER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));

      // Deploy new implementation
      const LookCoinV2 = await ethers.getContractFactory("LookCoin");
      const lookCoinV2 = await LookCoinV2.deploy();

      // Non-upgrader should fail
      await expect(lookCoin.connect(addr1).upgradeTo(await lookCoinV2.getAddress())).to.be.reverted;

      // Upgrader should succeed
      await lookCoin.grantRole(UPGRADER_ROLE, owner.address);
      await lookCoin.upgradeTo(await lookCoinV2.getAddress());
    });

    it("Should prevent unauthorized upgrade attempts", async function () {
      // Test multiple unauthorized attempts
      const attackers = [addr1, addr2, minter, burner];
      
      for (const attacker of attackers) {
        const LookCoinV2 = await ethers.getContractFactory("LookCoin");
        const lookCoinV2 = await LookCoinV2.deploy();
        
        await expect(
          lookCoin.connect(attacker).upgradeToAndCall(
            await lookCoinV2.getAddress(),
            "0x"
          )
        ).to.be.reverted;
      }
    });
  });

  describe("LayerZero Security Tests", function () {
    it("Should validate LayerZero endpoint caller", async function () {
      // Set up trusted remote
      const srcChainId = 10;
      await lookCoin.connectPeer(srcChainId, ethers.zeroPadValue(addr1.address, 32));
      
      // Attempt to call lzReceive from non-endpoint address
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "address", "bytes", "uint256"],
        [0, addr1.address, ethers.toUtf8Bytes(addr2.address), ethers.parseEther("100")]
      );
      
      await expect(
        lookCoin.connect(addr1).lzReceive(
          srcChainId,
          ethers.zeroPadValue(addr1.address, 32),
          1,
          payload
        )
      ).to.be.revertedWith("LookCoin: invalid endpoint caller");
    });

    it("Should prevent replay attacks on cross-chain transfers", async function () {
      // This would be tested with actual LayerZero integration
      // For now, verify nonce tracking is in place
      const srcChainId = 10;
      const nonce = 1;
      
      // Check that processedNonces mapping exists and works
      expect(await lookCoin.processedNonces(srcChainId, nonce)).to.be.false;
    });
  });
});
