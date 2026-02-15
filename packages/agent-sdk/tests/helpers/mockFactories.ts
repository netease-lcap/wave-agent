import { vi, type Mock } from "vitest";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionMode } from "../../src/types/permissions.js";
import type { TaskManager } from "../../src/services/taskManager.js";

interface MockToolManager {
  execute: Mock<ToolManager["execute"]>;
  list: Mock<ToolManager["list"]>;
  getTools: Mock<ToolManager["getTools"]>;
  getToolsConfig: Mock<ToolManager["getToolsConfig"]>;
  getPermissionMode: Mock<ToolManager["getPermissionMode"]>;
  setPermissionMode: Mock<ToolManager["setPermissionMode"]>;
  initializeBuiltInTools: Mock<ToolManager["initializeBuiltInTools"]>;
  getPermissionManager: Mock<ToolManager["getPermissionManager"]>;
  instance: ToolManager;
}

/**
 * Creates a mock TaskManager instance.
 */
export const createMockTaskManager = (): TaskManager => {
  return {
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    listTasks: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as TaskManager;
};

/**
 * Creates a mock ToolManager instance and its associated mock functions.
 * This allows tests to both use the instance and control/assert on its methods.
 */
export const createMockToolManager = (): MockToolManager => {
  const execute = vi.fn();
  const list = vi.fn(() => []);
  const getTools = vi.fn(() => []);
  const getToolsConfig = vi.fn(() => []);
  const getPermissionMode = vi.fn(() => "default" as PermissionMode);
  const setPermissionMode = vi.fn();
  const initializeBuiltInTools = vi.fn();
  const getPermissionManager = vi.fn();

  return {
    // Individual mocks for control and assertions
    execute,
    list,
    getTools,
    getToolsConfig,
    getPermissionMode,
    setPermissionMode,
    initializeBuiltInTools,
    getPermissionManager,

    // The object that behaves like a ToolManager instance
    instance: {
      execute,
      list,
      getTools,
      getToolsConfig,
      getPermissionMode,
      setPermissionMode,
      initializeBuiltInTools,
      getPermissionManager,
    } as unknown as ToolManager,
  };
};
