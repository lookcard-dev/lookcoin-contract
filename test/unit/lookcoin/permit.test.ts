import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { LookCoin } from "../../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LookCoin Permit Functionality", function () {
  let lookCoin: LookCoin;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy LookCoin as a proxy
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin,
      [owner.address, ethers.ZeroAddress],
      { initializer: "initialize", kind: "uups" }
    ) as any;
    await lookCoin.waitForDeployment();

    // Call initializePermit to enable permit functionality
    await lookCoin.initializePermit();

    // Grant MINTER_ROLE to owner and mint initial supply
    const MINTER_ROLE = await lookCoin.MINTER_ROLE();
    await lookCoin.grantRole(MINTER_ROLE, owner.address);
    await lookCoin.mint(alice.address, INITIAL_SUPPLY);
  });

  describe("EIP-2612 Permit", function () {
    it("Should have correct DOMAIN_SEPARATOR", async function () {
      const domainSeparator = await lookCoin.DOMAIN_SEPARATOR();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });

    it("Should have correct PERMIT_TYPEHASH", async function () {
      const permitTypehash = await lookCoin.PERMIT_TYPEHASH();
      // EIP-2612 standard permit typehash
      expect(permitTypehash).to.equal(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
          )
        )
      );
    });

    it("Should execute permit successfully", async function () {
      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600; // 1 hour from now
      const nonce = await lookCoin.nonces(alice.address);

      // Create permit signature
      const domain = {
        name: "LookCoin",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await lookCoin.getAddress()
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        owner: alice.address,
        spender: bob.address,
        value: amount,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await alice.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      // Check initial allowance
      expect(await lookCoin.allowance(alice.address, bob.address)).to.equal(0);

      // Execute permit
      await lookCoin.permit(alice.address, bob.address, amount, deadline, v, r, s);

      // Check allowance after permit
      expect(await lookCoin.allowance(alice.address, bob.address)).to.equal(amount);
    });

    it("Should fail permit with expired deadline", async function () {
      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) - 1; // Already expired
      const nonce = await lookCoin.nonces(alice.address);

      const domain = {
        name: "LookCoin",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await lookCoin.getAddress()
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        owner: alice.address,
        spender: bob.address,
        value: amount,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await alice.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        lookCoin.permit(alice.address, bob.address, amount, deadline, v, r, s)
      ).to.be.revertedWithCustomError(lookCoin, "ERC2612ExpiredSignature");
    });

    it("Should fail permit with invalid signature", async function () {
      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonce = await lookCoin.nonces(alice.address);

      // Bob signs instead of Alice (invalid)
      const domain = {
        name: "LookCoin",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await lookCoin.getAddress()
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        owner: alice.address,
        spender: bob.address,
        value: amount,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await bob.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        lookCoin.permit(alice.address, bob.address, amount, deadline, v, r, s)
      ).to.be.revertedWithCustomError(lookCoin, "ERC2612InvalidSigner");
    });

    it("Should increment nonce after successful permit", async function () {
      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonceBefore = await lookCoin.nonces(alice.address);

      const domain = {
        name: "LookCoin",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await lookCoin.getAddress()
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        owner: alice.address,
        spender: bob.address,
        value: amount,
        nonce: nonceBefore,
        deadline: deadline
      };

      const signature = await alice.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await lookCoin.permit(alice.address, bob.address, amount, deadline, v, r, s);

      const nonceAfter = await lookCoin.nonces(alice.address);
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });

    it("Should work with transferFrom after permit", async function () {
      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonce = await lookCoin.nonces(alice.address);

      const domain = {
        name: "LookCoin",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await lookCoin.getAddress()
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        owner: alice.address,
        spender: bob.address,
        value: amount,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await alice.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      // Execute permit
      await lookCoin.permit(alice.address, bob.address, amount, deadline, v, r, s);

      // Bob can now transferFrom Alice
      const balanceBefore = await lookCoin.balanceOf(bob.address);
      await lookCoin.connect(bob).transferFrom(alice.address, bob.address, amount);
      const balanceAfter = await lookCoin.balanceOf(bob.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });
});