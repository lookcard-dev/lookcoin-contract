import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("SecurityManagerModule", (m) => {
  // Get parameters
  const governanceVault = m.getParameter("governanceVault");
  const globalDailyLimit = m.getParameter("globalDailyLimit", "2000000000000000000000000000"); // 2B tokens

  // Validate parameters
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy SecurityManager
  const securityManager = m.contract("SecurityManager");

  // Initialize SecurityManager
  m.call(securityManager, "initialize", [governanceVault, globalDailyLimit]);

  // Set up protocol-specific configurations
  const protocolConfigs = m.getParameter("protocolConfigs", {
    "0": {
      // LayerZero
      dailyLimit: "500000000000000000000000000", // 500M tokens
      transactionLimit: "50000000000000000000000000", // 50M tokens
      cooldownPeriod: 300, // 5 minutes
    },
    "1": {
      // Celer
      dailyLimit: "300000000000000000000000000", // 300M tokens
      transactionLimit: "30000000000000000000000000", // 30M tokens
      cooldownPeriod: 600, // 10 minutes
    },
    "2": {
      // XERC20
      dailyLimit: "200000000000000000000000000", // 200M tokens
      transactionLimit: "20000000000000000000000000", // 20M tokens
      cooldownPeriod: 300, // 5 minutes
    },
    "3": {
      // Hyperlane
      dailyLimit: "100000000000000000000000000", // 100M tokens
      transactionLimit: "10000000000000000000000000", // 10M tokens
      cooldownPeriod: 900, // 15 minutes
    },
  });

  for (const [protocol, config] of Object.entries(protocolConfigs)) {
    const { dailyLimit, transactionLimit, cooldownPeriod } = config as any;
    m.call(securityManager, "updateProtocolConfig", [
      parseInt(protocol),
      dailyLimit,
      transactionLimit,
      cooldownPeriod,
    ]);
  }

  // Set anomaly thresholds
  const anomalyThreshold = m.getParameter("anomalyThreshold", {
    volumeThreshold: "1000000000000000000000000", // 1M tokens
    frequencyThreshold: 10,
    timeWindow: 3600, // 1 hour
  });

  m.call(securityManager, "updateAnomalyThreshold", [
    anomalyThreshold.volumeThreshold,
    anomalyThreshold.frequencyThreshold,
    anomalyThreshold.timeWindow,
  ]);

  // Set rate limiting parameters (from RateLimiter inheritance)
  const rateLimitConfig = m.getParameter("rateLimitConfig", {
    perTransactionLimit: "500000000000000000000000", // 500K tokens
    windowDuration: 3600, // 1 hour
    transactionsPerWindow: 3,
    globalDailyLimit: "2000000000000000000000000000", // 2B tokens
  });

  m.call(securityManager, "setRateLimits", [
    rateLimitConfig.perTransactionLimit,
    rateLimitConfig.windowDuration,
    rateLimitConfig.transactionsPerWindow,
    rateLimitConfig.globalDailyLimit,
  ]);

  return { securityManager };
});