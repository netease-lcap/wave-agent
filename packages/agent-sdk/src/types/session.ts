/**
 * Session management types for project-based organization with JSONL format
 * Dependencies: Core messaging types
 */

import type { Message } from "./messaging.js";

// Enhanced message interface for JSONL storage (extends existing Message)
export interface SessionMessage extends Message {
  timestamp: string; // ISO 8601 - added for JSONL format
  // Inherits: role: "user" | "assistant", blocks: MessageBlock[], usage?, metadata?
}

// Session file entity
export interface SessionFile {
  readonly sessionId: string; // UUIDv6
  readonly filePath: string;
  readonly workdir: string;
  readonly messageCount: number;
  readonly fileSize: number;
  readonly createdAt: Date; // Derived from UUIDv6
  readonly lastModified: Date;
}

// Project directory entity
export interface ProjectDirectory {
  readonly originalPath: string;
  readonly encodedName: string;
  readonly encodedPath: string;
  readonly pathHash?: string; // For collision resolution
  readonly isSymbolicLink: boolean;
}

// Session directory entity
export interface SessionDirectory {
  readonly basePath: string;
  readonly exists: boolean;
  readonly permissions: "read" | "write" | "readwrite" | "none";
}

// Session metadata for listing operations (enhanced version)
export interface SessionMetadataV2 {
  readonly id: string; // UUIDv6
  readonly workdir: string;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
  readonly messageCount: number;
  readonly fileSize: number;
}

// Session creation options
export interface SessionCreationOptions {
  workdir: string;
  generateId?: boolean; // Default true, for testing override
  initialMessages?: SessionMessage[];
}

// Session listing filters
export interface SessionListFilter {
  workdir?: string;
  includeAllWorkdirs?: boolean;
  maxAge?: number; // Days
  limit?: number;
  sortBy?: "createdAt" | "lastActiveAt" | "messageCount";
  sortOrder?: "asc" | "desc";
}

// Session loading options
export interface SessionLoadOptions {
  sessionId: string;
  streaming?: boolean; // Default false
  messageLimit?: number; // For partial loading
}

// Message append options
export interface MessageAppendOptions {
  sessionId: string;
  messages: SessionMessage[];
  autoFlush?: boolean; // Default true
}

// Session cleanup options
export interface SessionCleanupOptions {
  workdir?: string;
  maxAge: number; // Days
  dryRun?: boolean;
}

// New session data format for JSONL
export interface SessionDataV2 {
  readonly sessionId: string; // UUIDv6
  readonly workdir: string;
  readonly messages: SessionMessage[];
  readonly messageCount: number;
  readonly fileSize: number;
  readonly createdAt: Date;
  readonly lastModified: Date;
  readonly filePath: string;
}
