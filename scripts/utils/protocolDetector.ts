import { ChainConfig } from "../../hardhat.config";

export interface ProtocolSupport {
  layerZero: boolean;
  celer: boolean;
  xerc20: boolean;
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
      xerc20: false,
      hyperlane: false,
      protocols: []
    };

    // Prefer protocols object if available
    if (chainConfig.protocols) {
      support.layerZero = !!chainConfig.protocols.layerZero;
      support.celer = !!chainConfig.protocols.celer;
      support.xerc20 = !!chainConfig.protocols.xerc20;
      support.hyperlane = !!chainConfig.protocols.hyperlane;
    } else {
      // Fallback to checking endpoint addresses
      support.layerZero = this.isValidAddress(chainConfig.layerZeroEndpoint);
      support.celer = this.isValidAddress(chainConfig.celerMessageBus);
      support.xerc20 = this.isValidAddress(chainConfig.xerc20Factory);
      support.hyperlane = this.isValidAddress(chainConfig.hyperlaneMailbox);
    }

    // Build protocols array
    if (support.layerZero) support.protocols.push("layerZero");
    if (support.celer) support.protocols.push("celer");
    if (support.xerc20) support.protocols.push("xerc20");
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
      case "xerc20":
        return support.xerc20;
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
      case "xerc20":
        return {
          endpoint: chainConfig.xerc20Factory || ""
        };
      case "hyperlane":
        return {
          endpoint: chainConfig.hyperlaneMailbox || "",
          additionalSettings: {
            hyperlaneISM: chainConfig.hyperlaneISM,
            hyperlaneDomain: chainConfig.hyperlaneDomain
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
}