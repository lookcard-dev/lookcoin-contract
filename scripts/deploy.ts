import { ethers, upgrades } from "hardhat";
import { LZ_ENDPOINTS, CELER_MESSAGEBUS } from "../hardhat.config";

async function main() {
  console.log("Starting LookCoin deployment...");
  
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;
  
  console.log(`Deploying on chain ${chainId} with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);
  
  // Get network name
  let networkName: string;
  let lzEndpoint: string;
  let celerMessageBus: string;
  
  switch (chainId) {
    case 56:
      networkName = "BSC Mainnet";
      lzEndpoint = LZ_ENDPOINTS.bsc;
      celerMessageBus = CELER_MESSAGEBUS.bsc;
      break;
    case 97:
      networkName = "BSC Testnet";
      lzEndpoint = LZ_ENDPOINTS.bscTestnet;
      celerMessageBus = CELER_MESSAGEBUS.bscTestnet;
      break;
    case 8453:
      networkName = "Base Mainnet";
      lzEndpoint = LZ_ENDPOINTS.base;
      celerMessageBus = CELER_MESSAGEBUS.base;
      break;
    case 84531:
      networkName = "Base Testnet";
      lzEndpoint = LZ_ENDPOINTS.baseTestnet;
      celerMessageBus = CELER_MESSAGEBUS.baseTestnet;
      break;
    case 10:
      networkName = "Optimism Mainnet";
      lzEndpoint = LZ_ENDPOINTS.optimism;
      celerMessageBus = CELER_MESSAGEBUS.optimism;
      break;
    case 420:
      networkName = "Optimism Testnet";
      lzEndpoint = LZ_ENDPOINTS.optimismTestnet;
      celerMessageBus = CELER_MESSAGEBUS.optimismTestnet;
      break;
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  
  console.log(`\nDeploying on ${networkName}`);
  console.log(`LayerZero Endpoint: ${lzEndpoint}`);
  console.log(`Celer MessageBus: ${celerMessageBus}`);
  
  // Deploy LookCoin
  console.log("\n1. Deploying LookCoin...");
  const LookCoin = await ethers.getContractFactory("LookCoin");
  const lookCoin = await upgrades.deployProxy(
    LookCoin,
    [lzEndpoint, deployer.address],
    { 
      initializer: "initialize",
      kind: "uups"
    }
  );
  await lookCoin.deployed();
  console.log(`LookCoin deployed to: ${lookCoin.address}`);
  console.log(`Implementation: ${await upgrades.erc1967.getImplementationAddress(lookCoin.address)}`);
  
  // Deploy CelerIMModule (if Celer is available on this chain)
  let celerModule;
  if (celerMessageBus !== "0x0000000000000000000000000000000000000000") {
    console.log("\n2. Deploying CelerIMModule...");
    const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
    celerModule = await upgrades.deployProxy(
      CelerIMModule,
      [celerMessageBus, lookCoin.address, deployer.address],
      {
        initializer: "initialize",
        kind: "uups"
      }
    );
    await celerModule.deployed();
    console.log(`CelerIMModule deployed to: ${celerModule.address}`);
  }
  
  // Deploy IBCModule (only on BSC)
  let ibcModule;
  if (chainId === 56 || chainId === 97) {
    console.log("\n3. Deploying IBCModule...");
    const IBCModule = await ethers.getContractFactory("IBCModule");
    
    // Create vault multisig (in production, use actual multisig)
    const vaultAddress = deployer.address;
    
    ibcModule = await upgrades.deployProxy(
      IBCModule,
      [lookCoin.address, vaultAddress, deployer.address],
      {
        initializer: "initialize",
        kind: "uups"
      }
    );
    await ibcModule.deployed();
    console.log(`IBCModule deployed to: ${ibcModule.address}`);
  }
  
  // Deploy SupplyOracle
  console.log("\n4. Deploying SupplyOracle...");
  const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
  const totalSupply = ethers.utils.parseUnits("1000000000", 8); // 1 billion LOOK
  const supplyOracle = await upgrades.deployProxy(
    SupplyOracle,
    [deployer.address, totalSupply],
    {
      initializer: "initialize",
      kind: "uups"
    }
  );
  await supplyOracle.deployed();
  console.log(`SupplyOracle deployed to: ${supplyOracle.address}`);
  
  // Deploy MPCMultisig
  console.log("\n5. Deploying MPCMultisig...");
  const MPCMultisig = await ethers.getContractFactory("MPCMultisig");
  
  // In production, use actual MPC signer addresses
  const signers = [
    deployer.address,
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444"
  ];
  
  const mpcMultisig = await upgrades.deployProxy(
    MPCMultisig,
    [signers, deployer.address],
    {
      initializer: "initialize",
      kind: "uups"
    }
  );
  await mpcMultisig.deployed();
  console.log(`MPCMultisig deployed to: ${mpcMultisig.address}`);
  
  // Configure roles
  console.log("\n6. Configuring roles...");
  
  // Grant MINTER_ROLE to bridge modules
  if (celerModule) {
    await lookCoin.grantRole(await lookCoin.MINTER_ROLE(), celerModule.address);
    console.log(`Granted MINTER_ROLE to CelerIMModule`);
  }
  if (ibcModule) {
    await lookCoin.grantRole(await lookCoin.MINTER_ROLE(), ibcModule.address);
    console.log(`Granted MINTER_ROLE to IBCModule`);
  }
  
  // Grant BURNER_ROLE to LookCoin itself (for LayerZero burns)
  await lookCoin.grantRole(await lookCoin.BURNER_ROLE(), lookCoin.address);
  console.log(`Granted BURNER_ROLE to LookCoin`);
  
  // Transfer admin roles to MPC multisig
  console.log("\n7. Transferring admin control to MPC multisig...");
  await lookCoin.grantRole(await lookCoin.DEFAULT_ADMIN_ROLE(), mpcMultisig.address);
  await lookCoin.grantRole(await lookCoin.PAUSER_ROLE(), mpcMultisig.address);
  await lookCoin.grantRole(await lookCoin.UPGRADER_ROLE(), mpcMultisig.address);
  
  // Register bridges with SupplyOracle
  console.log("\n8. Registering bridges with SupplyOracle...");
  await supplyOracle.registerBridge(chainId, lookCoin.address);
  if (celerModule) {
    await supplyOracle.registerBridge(chainId, celerModule.address);
  }
  if (ibcModule) {
    await supplyOracle.registerBridge(chainId, ibcModule.address);
  }
  
  // Save deployment addresses
  const deployment = {
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      LookCoin: {
        proxy: lookCoin.address,
        implementation: await upgrades.erc1967.getImplementationAddress(lookCoin.address)
      },
      CelerIMModule: celerModule ? {
        proxy: celerModule.address,
        implementation: await upgrades.erc1967.getImplementationAddress(celerModule.address)
      } : null,
      IBCModule: ibcModule ? {
        proxy: ibcModule.address,
        implementation: await upgrades.erc1967.getImplementationAddress(ibcModule.address)
      } : null,
      SupplyOracle: {
        proxy: supplyOracle.address,
        implementation: await upgrades.erc1967.getImplementationAddress(supplyOracle.address)
      },
      MPCMultisig: {
        proxy: mpcMultisig.address,
        implementation: await upgrades.erc1967.getImplementationAddress(mpcMultisig.address)
      }
    },
    config: {
      layerZeroEndpoint: lzEndpoint,
      celerMessageBus: celerMessageBus
    }
  };
  
  console.log("\n9. Deployment Summary:");
  console.log(JSON.stringify(deployment, null, 2));
  
  // Write deployment to file
  const fs = require("fs");
  const deploymentPath = `./deployments/${networkName.toLowerCase().replace(/\s+/g, "-")}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${deploymentPath}`);
  
  console.log("\n✅ Deployment completed successfully!");
  console.log("\n⚠️  Next steps:");
  console.log("1. Run configure.ts to set up cross-chain connections");
  console.log("2. Verify contracts on block explorer");
  console.log("3. Configure monitoring and alerting");
  console.log("4. Transfer remaining admin roles from deployer to MPC multisig");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });