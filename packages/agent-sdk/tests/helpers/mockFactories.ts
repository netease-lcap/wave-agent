import { vi, type Mock } from "vitest";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionMode } from "../../src/types/permissions.js";

interface MockToolManager {
  execute: Mock<ToolManager["execute"]>;
  list: Mock<ToolManager["list"]>;
  getToolsConfig: Mock<ToolManager["getToolsConfig"]>;
  getPermissionMode: Mock<ToolManager["getPermissionMode"]>;
  setPermissionMode: Mock<ToolManager["setPermissionMode"]>;
  initializeBuiltInTools: Mock<ToolManager["initializeBuiltInTools"]>;
  getPermissionManager: Mock<ToolManager["getPermissionManager"]>;
  instance: ToolManager;
}

/**
 * Creates a mock ToolManager instance and its associated mock functions.
 * This allows tests to both use the instance and control/assert on its methods.
 */
export const createMockToolManager = (): MockToolManager => {
  const execute = vi.fn();
  const list = vi.fn(() => []);
  const getToolsConfig = vi.fn(() => []);
  const getPermissionMode = vi.fn(() => "default" as PermissionMode);
  const setPermissionMode = vi.fn();
  const initializeBuiltInTools = vi.fn();
  const getPermissionManager = vi.fn();

  return {
    // Individual mocks for control and assertions
    execute,
    list,
    getToolsConfig,
    getPermissionMode,
    setPermissionMode,
    initializeBuiltInTools,
    getPermissionManager,

    // The object that behaves like a ToolManager instance
    instance: {
      execute,
      list,
      getToolsConfig,
      getPermissionMode,
      setPermissionMode,
      initializeBuiltInTools,
      getPermissionManager,
    } as unknown as ToolManager,
  };
};
