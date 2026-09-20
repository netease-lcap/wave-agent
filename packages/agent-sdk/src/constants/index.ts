/**
 * Constants entry (`wave-agent-sdk/constants`).
 *
 * Hosts that drive the agent over JSON-RPC import shared values from here rather
 * than from the SDK barrel: the barrel pulls in the whole agent runtime,
 * including dependencies that do work while their module body evaluates and can
 * therefore take a host down at load time. Every module re-exported below must
 * stay dependency-free so this entry remains cheap to bundle.
 */
export * from "./memory.js";
export * from "./messages.js";
export * from "./subagents.js";
export * from "./toolLimits.js";
export * from "./tools.js";
