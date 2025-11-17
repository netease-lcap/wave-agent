/**
 * Test setup and mocking infrastructure for hook exit code output tests
 */

import { vi } from "vitest";

// Mock the session service to prevent real file operations
vi.mock("@/services/session", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

// Mock AI Service to prevent real network calls - use same pattern as working tests
vi.mock("@/services/aiService");

// Mock hook service to control hook execution
vi.mock("@/services/hook", () => ({
  executeCommand: vi.fn(),
  executeCommands: vi.fn(),
  loadMergedHooksConfig: vi.fn(() => ({})),
  isCommandSafe: vi.fn(() => true),
}));

// Mock HookManager to control hook execution results
vi.mock("@/managers/hookManager", () => ({
  HookManager: vi.fn().mockImplementation(() => ({
    loadConfigurationFromSettings: vi.fn(),
    executeHooks: vi.fn(() => Promise.resolve([])),
    hasHooks: vi.fn(() => false),
    validateConfiguration: vi.fn(() => ({ valid: true, errors: [] })),
    getConfiguration: vi.fn(() => ({})),
  })),
}));

// Mock the toolManager
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memory manager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn(() => ({
    getUserMemoryContent: vi.fn().mockResolvedValue(""),
  })),
}));

// Mock file system operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock path operations
vi.mock("path", () => ({
  join: vi.fn((...paths: string[]) => paths.join("/")),
  resolve: vi.fn((path: string) => path),
  dirname: vi.fn((path: string) => path.split("/").slice(0, -1).join("/")),
}));
