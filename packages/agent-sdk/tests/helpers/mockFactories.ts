import { vi } from "vitest";

/**
 * Creates a mock ToolManager instance and its associated mock functions.
 * This allows tests to both use the instance and control/assert on its methods.
 */
export const createMockToolManager = () => {
  const execute = vi.fn();
  const list = vi.fn(() => []);
  const getToolsConfig = vi.fn(() => []);
  const getPermissionMode = vi.fn(() => "default");
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
    },
  };
};
