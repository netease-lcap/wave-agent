/**
 * Agent and service configuration types
 * Dependencies: None
 */

export interface GatewayConfig {
  apiKey: string;
  baseURL: string;
  defaultHeaders?: Record<string, string>;
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
}
