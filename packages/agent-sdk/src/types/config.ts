/**
 * Agent and service configuration types
 * Dependencies: None
 */

import OpenAI from "openai";
import { PermissionMode } from "./permissions.js";

export interface GatewayConfig {
  apiKey?: string;
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: OpenAI["fetchOptions"];
  fetch?: OpenAI["fetch"];
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
  maxTokens?: number;
  permissionMode?: PermissionMode;
}
