# TypeScript Interface Contracts

**Feature**: 010-split-types-by-domain  
**Purpose**: Define the interface contracts for domain-organized types

## Domain File Contracts

### Core Types Contract (`types/core.ts`)

```typescript
/**
 * Foundational types used across multiple domains
 * Dependencies: None (foundation layer)
 */

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number; 
  total_tokens: number;
  model?: string;
  operation_type?: "agent" | "compress";
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly provided?: unknown,
  );
}

export const CONFIG_ERRORS: {
  readonly MISSING_API_KEY: string;
  readonly MISSING_BASE_URL: string;
  readonly INVALID_TOKEN_LIMIT: string;
  readonly EMPTY_API_KEY: string;
  readonly EMPTY_BASE_URL: string;
} as const;
```

### Messaging Types Contract (`types/messaging.ts`)

```typescript
/**
 * Message and communication block types
 * Dependencies: Core (Usage)
 */

import type { Usage } from './core.js';

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage;
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | DiffBlock
  | CommandOutputBlock
  | CompressBlock
  | MemoryBlock
  | SubagentBlock;

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ErrorBlock {
  type: "error";
  content: string;
}

export interface ToolBlock {
  type: "tool";
  parameters?: string;
  result?: string;
  shortResult?: string;
  images?: Array<{
    data: string;
    mediaType?: string;
  }>;
  id?: string;
  name?: string;
  isRunning?: boolean;
  success?: boolean;
  error?: string | Error;
  compactParams?: string;
}

// Additional block type interfaces...
```

### MCP Types Contract (`types/mcp.ts`)

```typescript
/**
 * Model Context Protocol types
 * Dependencies: None
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  config: McpServerConfig;
  status: "disconnected" | "connected" | "connecting" | "error";
  tools?: McpTool[];
  toolCount?: number;
  capabilities?: string[];
  lastConnected?: number;
  error?: string;
}
```

### Processes Types Contract (`types/processes.ts`)

```typescript
/**
 * Background process and shell management types  
 * Dependencies: None
 */

import type { ChildProcess } from "child_process";

export interface BackgroundShell {
  id: string;
  process: ChildProcess;
  command: string;
  startTime: number;
  status: "running" | "completed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
}
```

### Commands Types Contract (`types/commands.ts`)

```typescript
/**
 * Slash command and custom command types
 * Dependencies: None  
 */

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string) => Promise<void> | void;
}

export interface CustomSlashCommandConfig {
  allowedTools?: string[];
  model?: string;
  description?: string;
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
}
```

### Skills Types Contract (`types/skills.ts`)

```typescript
/**
 * Skill system types and constants
 * Dependencies: Core (Logger)
 */

import type { Logger } from './core.js';

export interface SkillMetadata {
  name: string;
  description: string;
  type: "personal" | "project";
  skillPath: string;
}

export interface Skill extends SkillMetadata {
  content: string;
  frontmatter: SkillFrontmatter;
  isValid: boolean;
  errors: string[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

// Additional skill-related interfaces...

export const SKILL_DEFAULTS: {
  readonly PERSONAL_SKILLS_DIR: string;
  readonly PROJECT_SKILLS_DIR: string;
  readonly SKILL_FILE_NAME: string;
  readonly MAX_NAME_LENGTH: number;
  readonly MAX_DESCRIPTION_LENGTH: number;
  readonly MIN_DESCRIPTION_LENGTH: number;
  readonly NAME_PATTERN: RegExp;
  readonly MAX_METADATA_CACHE: number;
  readonly MAX_CONTENT_CACHE: number;
  readonly SCAN_TIMEOUT: number;
  readonly LOAD_TIMEOUT: number;
} as const;
```

### Configuration Types Contract (`types/config.ts`)

```typescript
/**
 * Agent and service configuration types
 * Dependencies: None
 */

export interface GatewayConfig {
  apiKey: string;
  baseURL: string;
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
}
```

### Main Index Contract (`types/index.ts`)

```typescript
/**
 * Barrel export for backward compatibility
 * Re-exports all domain types for legacy imports
 */

// Core foundational types
export * from './core.js';

// Domain-specific types
export * from './messaging.js';
export * from './mcp.js';
export * from './processes.js';
export * from './commands.js';
export * from './skills.js';
export * from './config.js';
```

## Import Pattern Contracts

### Legacy Import Pattern (Backward Compatible)
```typescript
// Continues to work - imports from main index
import { Message, Logger, McpTool } from 'wave-agent-sdk/types';
```

### Domain-Specific Import Pattern (New Capability)
```typescript
// Domain-specific imports for better organization
import { Message, ToolBlock } from 'wave-agent-sdk/types/messaging';
import { McpTool, McpServerStatus } from 'wave-agent-sdk/types/mcp';
import { Logger } from 'wave-agent-sdk/types/core';
```

### Cross-Domain Import Pattern (Internal Use)
```typescript
// Within domain files, import from other domains
// In types/messaging.ts:
import type { Usage } from './core.js';

// In types/skills.ts:
import type { Logger } from './core.js';
```

## Validation Contracts

### Domain Independence Contract
- Each domain file can be imported independently
- No circular import dependencies between domains
- Core domain has no external dependencies

### Type Integrity Contract
- All existing type names remain unchanged
- All type signatures remain backward compatible
- No breaking changes to public interfaces

### Build System Contract
- TypeScript compilation succeeds for all import patterns
- Tree-shaking works correctly with domain imports
- Package exports support both legacy and domain imports

These contracts ensure the type reorganization maintains functionality while providing the improved developer experience of domain-specific type imports.