import { ChainConfig } from "../../hardhat.config";

export interface ProtocolSupport {
  layerZero: boolean;
  celer: boolean;
  hyperlane: boolean;
  protocols: string[];
}

export interface ProtocolConfig {
  endpoint: string;
  chainId?: number;
  additionalSettings?: Record<string, any>;
}

export class ProtocolDetector {
  /**
   * Analyzes the chain configuration to detect which protocols are supported
   * @param chainConfig The chain configuration from hardhat.config.ts
   * @returns Object indicating which protocols are supported
   */
  static detectSupportedProtocols(chainConfig: ChainConfig): ProtocolSupport {
    const support: ProtocolSupport = {
      layerZero: false,
      celer: false,
      hyperlane: false,
      protocols: []
    };

    // Prefer protocols object if available
    if (chainConfig.protocols) {
      support.layerZero = !!chainConfig.protocols.layerZero;
      support.celer = !!chainConfig.protocols.celer;
      // Enhanced Hyperlane detection - check both mailbox AND gas paymaster
      support.hyperlane = !!chainConfig.protocols.hyperlane && this.isHyperlaneReady(chainConfig);
    } else {
      // Fallback to checking endpoint addresses
      support.layerZero = this.isValidAddress(chainConfig.layerZeroEndpoint);
      support.celer = this.isValidAddress(chainConfig.celerMessageBus);
      support.hyperlane = this.isValidAddress(chainConfig.hyperlaneMailbox) && 
                         this.isValidAddress(chainConfig.hyperlane?.gasPaymaster);
    }

    // Debug logging
    if (chainConfig.protocols?.hyperlane && !support.hyperlane) {
      console.log("⚠️  Hyperlane is not ready - missing mailbox or gas paymaster.");
    }

    // Build protocols array
    if (support.layerZero) support.protocols.push("layerZero");
    if (support.celer) support.protocols.push("celer");
    if (support.hyperlane) support.protocols.push("hyperlane");

    return support;
  }

  /**
   * Determines if a specific protocol should be deployed
   * @param protocol The protocol name
   * @param chainConfig The chain configuration
   * @returns true if the protocol should be deployed
   */
  static shouldDeployProtocol(protocol: string, chainConfig: ChainConfig): boolean {
    const support = this.detectSupportedProtocols(chainConfig);
    
    switch (protocol.toLowerCase()) {
      case "layerzero":
        return support.layerZero;
      case "celer":
        return support.celer;
      case "hyperlane":
        return support.hyperlane;
      default:
        return false;
    }
  }

  /**
   * Returns protocol-specific configuration for deployment
   * @param protocol The protocol name
   * @param chainConfig The chain configuration
   * @returns Protocol configuration or null if not supported
   */
  static getProtocolConfig(protocol: string, chainConfig: ChainConfig): ProtocolConfig | null {
    if (!this.shouldDeployProtocol(protocol, chainConfig)) {
      return null;
    }

    switch (protocol.toLowerCase()) {
      case "layerzero":
        return {
          endpoint: chainConfig.layerZeroEndpoint || "",
          chainId: chainConfig.layerZeroChainId,
          additionalSettings: {
            dvnAddresses: chainConfig.dvnAddresses || []
          }
        };
      case "celer":
        return {
          endpoint: chainConfig.celerMessageBus || "",
          chainId: chainConfig.celerChainId
        };
      case "hyperlane":
        return {
          endpoint: chainConfig.hyperlane?.mailbox || "",
          additionalSettings: {
            hyperlaneISM: chainConfig.hyperlane?.ism,
            hyperlaneDomainId: chainConfig.hyperlane?.hyperlaneDomainId,
            gasPaymaster: chainConfig.hyperlane?.gasPaymaster
          }
        };
      default:
        return null;
    }
  }

  /**
   * Determines if the network should use multi-protocol deployment mode
   * @param chainConfig The chain configuration
   * @returns true if multi-protocol mode should be used
   */
  static isMultiProtocolMode(chainConfig: ChainConfig): boolean {
    const support = this.detectSupportedProtocols(chainConfig);
    return support.protocols.length > 1;
  }

  /**
   * Validates if an address is non-zero
   * @param address The address to validate
   * @returns true if the address is valid (non-zero)
   */
  private static isValidAddress(address?: string): boolean {
    if (!address) return false;
    return address !== "" && 
           address !== "0x0000000000000000000000000000000000000000" &&
           address.toLowerCase() !== "0x0";
  }

  /**
   * Checks if Hyperlane is ready (has both mailbox and gas paymaster)
   * @param chainConfig The chain configuration
   * @returns True if Hyperlane is ready for deployment
   */
  static isHyperlaneReady(chainConfig: ChainConfig): boolean {
    return (
      this.isValidAddress(chainConfig.hyperlane?.mailbox) &&
      this.isValidAddress(chainConfig.hyperlane?.gasPaymaster)
    );
  }
}

// Export the isHyperlaneReady helper as a named export for convenience
export const isHyperlaneReady = ProtocolDetector.isHyperlaneReady.bind(ProtocolDetector);