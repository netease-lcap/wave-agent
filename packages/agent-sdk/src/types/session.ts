/**
 * Session management types for project-based organization with JSONL format
 * Dependencies: Core messaging types
 *
 * SIMPLIFIED: Removed unused interfaces to focus on core functionality
 */

// Session filename structure for simple filename-based metadata
export interface SessionFilename {
  sessionId: string;
  sessionType: "main" | "subagent";
}
