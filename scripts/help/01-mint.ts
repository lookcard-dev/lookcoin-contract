import hre from "hardhat";
import { ethers } from "hardhat";
import { loadDeployment } from "../utils/deployment";
import { getNetworkName } from "../../hardhat.config";

async function main() {
  const networkObj = await hre.ethers.provider.getNetwork();
  const chainId = Number(networkObj.chainId);
  const network = getNetworkName(chainId);
  console.log(`\n🔧 Minting LOOK tokens on ${network}...`);

  // Load deployment data
  const deployment = loadDeployment(network);
  if (!deployment || !deployment.contracts.LookCoin) {
    throw new Error(`No LookCoin deployment found for ${network}`);
  }

  const [signer] = await ethers.getSigners();
  console.log(`📝 Using signer: ${signer.address}`);

  // Get LookCoin contract
  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
  const LookCoin = await ethers.getContractAt("LookCoin", lookCoinAddress, signer);

  // Get decimals from contract
  const decimals = await LookCoin.decimals();
  console.log(`📏 Token decimals: ${decimals}`);

  // Configuration
  const MINT_TO_ADDRESS = process.env.MINT_TO_ADDRESS || "0x0000000000000000000000000000000000000000";
  const MINT_AMOUNT = process.env.MINT_AMOUNT || "1000000"; // Default 1M tokens

  if (MINT_TO_ADDRESS === "0x0000000000000000000000000000000000000000") {
    throw new Error("Please set MINT_TO_ADDRESS environment variable or pass it as an argument");
  }

  // Parse amount using the actual decimals from contract
  const amount = ethers.parseUnits(MINT_AMOUNT, decimals);

  console.log(`\n💰 Minting Configuration:`);
  console.log(`   - To Address: ${MINT_TO_ADDRESS}`);
  console.log(`   - Amount: ${MINT_AMOUNT} LOOK (${amount.toString()} wei)`);
  console.log(`   - Contract: ${lookCoinAddress}`);

  // Check if signer has MINTER_ROLE
  const MINTER_ROLE = await LookCoin.MINTER_ROLE();
  const hasMinterRole = await LookCoin.hasRole(MINTER_ROLE, signer.address);

  if (!hasMinterRole) {
    console.error(`\nL Error: Signer ${signer.address} does not have MINTER_ROLE`);
    console.log(`   Please grant MINTER_ROLE to this address first`);
    process.exit(1);
  }

  // Check current balance before minting
  const balanceBefore = await LookCoin.balanceOf(MINT_TO_ADDRESS);
  console.log(`\n📊 Current balance: ${ethers.formatUnits(balanceBefore, decimals)} LOOK`);

  // Perform the mint
  console.log(`\n🚀 Minting tokens...`);
  const tx = await LookCoin.mint(MINT_TO_ADDRESS, amount);
  console.log(`   Transaction hash: ${tx.hash}`);

  // Wait for confirmation
  const receipt = await tx.wait();
  console.log(`   Transaction confirmed in block: ${receipt.blockNumber}`);

  // Check new balance
  const balanceAfter = await LookCoin.balanceOf(MINT_TO_ADDRESS);
  console.log(`\n Minting successful!`);
  console.log(`   New balance: ${ethers.formatUnits(balanceAfter, decimals)} LOOK`);
  console.log(`   Minted: ${ethers.formatUnits(balanceAfter - balanceBefore, decimals)} LOOK`);

  // Display total supply info
  const totalSupply = await LookCoin.totalSupply();
  const totalMinted = await LookCoin.totalMinted();
  console.log(`\n📈 Supply Information:`);
  console.log(`   Total Supply: ${ethers.formatUnits(totalSupply, decimals)} LOOK`);
  console.log(`   Total Minted: ${ethers.formatUnits(totalMinted, decimals)} LOOK`);
}

// Command-line argument parsing
if (process.argv.length > 2) {
  // Override environment variables with command line arguments
  if (process.argv[2]) {
    process.env.MINT_TO_ADDRESS = process.argv[2];
  }
  if (process.argv[3]) {
    process.env.MINT_AMOUNT = process.argv[3];
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nL Error:", error);
    process.exit(1);
  });
