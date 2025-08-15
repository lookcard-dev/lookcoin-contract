import "dotenv/config";
import hre from "hardhat";
import { ethers } from "hardhat";
import { getNetworkName, TOTAL_SUPPLY } from "../../hardhat.config";
import { loadDeployment } from "../utils/deployment-unified";
import { LookCoin } from "../../typechain-types";

async function main() {
  // Get network info
  const chainId = parseInt(await hre.network.provider.send("eth_chainId"));
  const networkName = getNetworkName(chainId);

  console.log(`\n>� Minting LOOK tokens on ${networkName}...`);

  // Load environment variables
  const mintToAddress = process.env.MINT_TO_ADDRESS;
  const mintAmount = process.env.MINT_AMOUNT;

  if (!mintToAddress) {
    throw new Error("MINT_TO_ADDRESS environment variable is required");
  }

  if (!mintAmount) {
    throw new Error("MINT_AMOUNT environment variable is required");
  }

  // Validate address format
  if (!ethers.isAddress(mintToAddress)) {
    throw new Error(`Invalid address format: ${mintToAddress}`);
  }

  console.log(`Target Address: ${mintToAddress}`);
  console.log(`Amount: ${mintAmount} LOOK`);

  // Load deployment
  const deployment = loadDeployment(networkName);
  if (!deployment?.contracts?.LookCoin?.proxy) {
    throw new Error(`LookCoin proxy not found in deployment for network: ${networkName}`);
  }

  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
  console.log(`LookCoin Contract: ${lookCoinAddress}`);

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`Minting from: ${signer.address}`);

  // Connect to contract with proper typing
  const LookCoinFactory = await ethers.getContractFactory("LookCoin");
  const contract = LookCoinFactory.attach(lookCoinAddress).connect(signer) as LookCoin;

  // Get decimals from contract and parse amount
  const decimals = await contract.decimals();
  console.log(`Contract decimals: ${decimals}`);
  const amount = ethers.parseUnits(mintAmount, decimals);
  console.log(`Parsed amount: ${amount.toString()} wei`);

  // Check current total supply
  const currentSupply = await contract.totalSupply();
  console.log(`Current total supply: ${ethers.formatEther(currentSupply)} LOOK`);

  // Check supply cap (from hardhat config)
  const supplyCap = BigInt(TOTAL_SUPPLY);
  const newSupply = currentSupply + amount;

  if (newSupply > supplyCap) {
    throw new Error(
      `Minting ${mintAmount} LOOK would exceed supply cap. ` +
        `Current: ${ethers.formatEther(currentSupply)}, ` +
        `Cap: ${ethers.formatEther(supplyCap)}, ` +
        `New total would be: ${ethers.formatEther(newSupply)}`,
    );
  }

  // Check if signer has MINTER_ROLE
  const MINTER_ROLE = await contract.MINTER_ROLE();
  const hasMinterRole = await contract.hasRole(MINTER_ROLE, signer.address);

  if (!hasMinterRole) {
    throw new Error(`Address ${signer.address} does not have MINTER_ROLE`);
  }

  // Execute mint
  console.log(`\n= Executing mint transaction...`);
  const tx = await contract.mint(mintToAddress, amount);

  console.log(`Transaction hash: ${tx.hash}`);
  console.log(`Waiting for confirmation...`);

  const receipt = await tx.wait();

  if (receipt?.status === 1) {
    console.log(` Mint successful!`);
    console.log(`Block number: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // Get updated total supply
    const finalSupply = await contract.totalSupply();
    console.log(`Updated total supply: ${ethers.formatEther(finalSupply)} LOOK`);

    // Get recipient balance
    const recipientBalance = await contract.balanceOf(mintToAddress);
    console.log(`Recipient balance: ${ethers.formatEther(recipientBalance)} LOOK`);
  } else {
    throw new Error("Transaction failed");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("L Mint failed:", error);
    process.exit(1);
  });
