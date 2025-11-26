/**
 * Session management types for project-based organization with JSONL format
 * Dependencies: Core messaging types
 *
 * SIMPLIFIED: Removed unused interfaces to focus on core functionality
 */

import type { Message } from "./messaging.js";

// Enhanced message interface for JSONL storage (extends existing Message)
export interface SessionMessage extends Message {
  timestamp: string; // ISO 8601 - added for JSONL format
  // Inherits: role: "user" | "assistant", blocks: MessageBlock[], usage?, metadata?
}

// Metadata line that appears as the first line in JSONL session files
export interface SessionMetadataLine {
  __meta__: true;
  sessionId: string;
  sessionType: "main" | "subagent";
  parentSessionId?: string;
  subagentType?: string;
  workdir: string;
  startedAt: string;
}
