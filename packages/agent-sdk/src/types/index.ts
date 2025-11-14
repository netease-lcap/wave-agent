/**
 * Main type index - Barrel export for backward compatibility
 * Re-exports all domain types for legacy imports
 *
 * Legacy import pattern (continues to work):
 *   import { Message, Logger, McpTool } from 'wave-agent-sdk/types';
 *
 * New domain-specific import pattern:
 *   import { Message } from 'wave-agent-sdk/types/messaging';
 *   import { Logger } from 'wave-agent-sdk/types/core';
 *   import { McpTool } from 'wave-agent-sdk/types/mcp';
 */

// Core foundational types
export * from "./core.js";

// Domain-specific types
export * from "./messaging.js";
export * from "./hooks.js";
export * from "./mcp.js";
export * from "./processes.js";
export * from "./commands.js";
export * from "./skills.js";
export * from "./config.js";
