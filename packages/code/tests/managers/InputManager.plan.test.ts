import { describe, it, expect, vi } from "vitest";
import { InputManager } from "../../src/managers/InputManager.js";

describe("InputManager Plan Mode", () => {
  it("should cycle through permission modes including plan mode", () => {
    const onPermissionModeChange = vi.fn();
    const inputManager = new InputManager({ onPermissionModeChange });

    expect(inputManager.getPermissionMode()).toBe("default");

    // Cycle to acceptEdits
    inputManager.cyclePermissionMode();
    expect(inputManager.getPermissionMode()).toBe("acceptEdits");
    expect(onPermissionModeChange).toHaveBeenCalledWith("acceptEdits");

    // Cycle to plan
    inputManager.cyclePermissionMode();
    expect(inputManager.getPermissionMode()).toBe("plan");
    expect(onPermissionModeChange).toHaveBeenCalledWith("plan");

    // Cycle back to default
    inputManager.cyclePermissionMode();
    expect(inputManager.getPermissionMode()).toBe("default");
    expect(onPermissionModeChange).toHaveBeenCalledWith("default");
  });
});
