/**
 * Agent and service configuration types
 * Dependencies: None
 */

import OpenAI from "openai";

export interface GatewayConfig {
  apiKey: string;
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: OpenAI["fetchOptions"];
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
}
