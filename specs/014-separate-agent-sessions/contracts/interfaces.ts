/**
 * Updated interfaces for MessageManager and Session Service
 */

import type { Logger, Message, Usage } from "../types/index.js";

// packages/agent-sdk/src/managers/messageManager.ts

export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  sessionDir?: string;
  
  // NEW FIELD
  sessionPrefix?: string;
}

// packages/agent-sdk/src/services/session.ts

export declare function getSessionFilePath(
  sessionId: string,
  sessionDir?: string,
  // NEW PARAMETER
  prefix?: string
): string;

export declare function saveSession(
  sessionId: string,
  messages: Message[],
  workdir: string,
  latestTotalTokens?: number,
  startedAt?: string,
  sessionDir?: string,
  // NEW PARAMETER
  prefix?: string
): Promise<void>;

export declare function loadSession(
  sessionId: string,
  sessionDir?: string,
  // NEW PARAMETER (Optional, might be needed if we want to load specific types, 
  // but loadSession usually works by ID. However, if ID doesn't contain prefix info, 
  // we might need to search or know the prefix. 
  // NOTE: Current implementation uses getSessionFilePath which constructs the path.
  // If getSessionFilePath requires prefix, then loadSession MUST also require it 
  // OR we need a way to find the file without knowing the prefix.)
  prefix?: string 
): Promise<SessionData | null>;

// NOTE: If loadSession relies on getSessionFilePath, and getSessionFilePath relies on prefix,
// then we have a problem if we don't know the prefix when loading.
// However, usually we load by ID. If the ID is just UUID, we don't know the prefix.
// 
// Strategy for loading:
// 1. Try default prefix "session"
// 2. Try "subagent_session"
// 3. Or list files and find the one matching the ID suffix.
//
// For this feature, the primary requirement is SAVING with different names.
// Loading might need adjustment.
//
// Let's check `loadSession` implementation again.
// It calls `getSessionFilePath`.
//
// If we change `getSessionFilePath` to require prefix, `loadSession` breaks for subagents unless we pass prefix.
//
// Refined Strategy for `loadSession`:
// It should probably try to find the file if the prefix is not provided, or we accept that we need to know the prefix to load.
// Given the requirement is about "Distinguishable Session Files" for debugging, maybe programmatic loading of subagent sessions isn't the primary flow, 
// but `listSessions` needs to work.
//
// `listSessions` iterates over files. It checks `startsWith("session_")`.
// It needs to be updated to check for `subagent_session_` too, or just `endsWith(".json")` and parse.
