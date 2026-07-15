/**
 * Agent and service configuration types
 * Dependencies: None
 */

import OpenAI from "openai";
import { PermissionMode } from "./permissions.js";

export interface GatewayConfig {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: OpenAI["fetchOptions"];
  fetch?: OpenAI["fetch"];
}

export interface ModelCapabilities {
  /** Whether the model supports image/vision input. Default: true. */
  vision?: boolean;
  /** Whether the model supports prompt caching (ephemeral cache_control markers). Default: false. */
  promptCaching?: boolean;
}

export interface ModelConfig {
  model?: string;
  fastModel?: string;
  maxTokens?: number;
  permissionMode?: PermissionMode;
  capabilities?: ModelCapabilities;
  /** Generation params passed through to the API provider (temperature, thinking, etc.) */
  options?: Record<string, unknown>;
  /** Fast model generation params (resolved from models[fastModel].options) */
  fastModelOptions?: Record<string, unknown>;
}
