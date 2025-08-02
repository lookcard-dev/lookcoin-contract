import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { loadDeployment, saveDeployment } from "./utils/deployment";

async function main() {
  const networkName = hre.network.name;
  console.log(`Deploying MinimalTimelock on ${networkName}...`);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get governance vault from environment
  const governanceVault = process.env.GOVERNANCE_VAULT;
  if (!governanceVault) {
    throw new Error("GOVERNANCE_VAULT not set in environment");
  }

  // Deploy MinimalTimelock
  const MinimalTimelock = await ethers.getContractFactory("MinimalTimelock");
  const timelock = await upgrades.deployProxy(
    MinimalTimelock,
    [governanceVault], // Initialize with governance vault as admin
    { initializer: "initialize" }
  );
  await timelock.waitForDeployment();

  const timelockAddress = await timelock.getAddress();
  console.log("MinimalTimelock deployed to:", timelockAddress);

  // Load existing deployment
  const deployment = await loadDeployment(networkName);
  
  // Add timelock to deployment
  deployment.minimalTimelock = {
    address: timelockAddress,
    implementationAddress: await upgrades.erc1967.getImplementationAddress(timelockAddress),
    blockNumber: (await ethers.provider.getBlockNumber()).toString(),
  };

  // Save updated deployment
  await saveDeployment(networkName, deployment);

  console.log("\nTimelock deployment complete!");
  console.log("Next steps:");
  console.log("1. Grant UPGRADER_ROLE in LookCoin to the timelock contract");
  console.log("2. Grant PROTOCOL_ADMIN_ROLE in LookCoin to the timelock contract");
  console.log("3. Consider revoking direct admin roles after timelock is tested");

  // Verify on block explorer if not local
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nWaiting for block confirmations before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    try {
      await hre.run("verify:verify", {
        address: timelockAddress,
        constructorArguments: [],
      });
      console.log("Timelock verified on block explorer");
    } catch (error) {
      console.log("Verification failed:", error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });