import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InputManager,
  InputManagerCallbacks,
} from "../../src/managers/InputManager.js";
import type { Key } from "ink";

describe("InputManager Permission Mode", () => {
  let manager: InputManager;
  let mockCallbacks: InputManagerCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallbacks = {
      onPermissionModeChange: vi.fn(),
    };
    manager = new InputManager(mockCallbacks);
  });

  afterEach(() => {
    manager.destroy();
  });

  it("should start with 'default' mode", () => {
    expect(manager.getPermissionMode()).toBe("default");
  });

  it("should cycle through permission modes when Shift+Tab is pressed", async () => {
    const shiftTabKey: Key = {
      tab: true,
      shift: true,
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      return: false,
      escape: false,
      ctrl: false,
      backspace: false,
      delete: false,
      pageDown: false,
      pageUp: false,
      meta: false,
    };

    // First Shift+Tab: default -> acceptEdits
    await manager.handleInput("", shiftTabKey, []);
    expect(manager.getPermissionMode()).toBe("acceptEdits");
    expect(mockCallbacks.onPermissionModeChange).toHaveBeenCalledWith(
      "acceptEdits",
    );

    // Second Shift+Tab: acceptEdits -> default
    await manager.handleInput("", shiftTabKey, []);
    expect(manager.getPermissionMode()).toBe("default");
    expect(mockCallbacks.onPermissionModeChange).toHaveBeenCalledWith(
      "default",
    );
  });

  it("should work without onPermissionModeChange callback", () => {
    const managerWithoutCallback = new InputManager({});
    expect(managerWithoutCallback.getPermissionMode()).toBe("default");
    managerWithoutCallback.cyclePermissionMode();
    expect(managerWithoutCallback.getPermissionMode()).toBe("acceptEdits");
  });

  it("should transition from 'bypassPermissions' to 'default' when Shift+Tab is pressed", async () => {
    const shiftTabKey: Key = {
      tab: true,
      shift: true,
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      return: false,
      escape: false,
      ctrl: false,
      backspace: false,
      delete: false,
      pageDown: false,
      pageUp: false,
      meta: false,
    };

    manager.setPermissionMode("bypassPermissions");
    expect(manager.getPermissionMode()).toBe("bypassPermissions");

    await manager.handleInput("", shiftTabKey, []);
    expect(manager.getPermissionMode()).toBe("default");
    expect(mockCallbacks.onPermissionModeChange).toHaveBeenCalledWith(
      "default",
    );
  });
});
