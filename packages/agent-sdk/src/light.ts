/**
 * Lightweight entry point — exposes only the constants, types, and type-only
 * exports that UI consumers (vsce, desktop webview) need, without pulling in
 * the full SDK runtime (openai, turndown, etc.).
 *
 * This keeps consumer bundles small: all exports here are either erased at
 * compile time (types) or pure constants, so bundlers can tree-shake the rest.
 */
export * from "./constants/tools.js";
export * from "./types/index.js";
export type { SessionMetadata } from "./services/session.js";
export type { ToolBlockUpdateCallbackParams } from "./utils/messageOperations.js";
export type { QueuedMessage } from "./managers/messageQueue.js";
