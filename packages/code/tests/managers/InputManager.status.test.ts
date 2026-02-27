import { describe, it, expect, vi } from "vitest";
import { InputManager } from "../../src/managers/InputManager.js";

describe("InputManager Status Command", () => {
  it("should handle status command", async () => {
    const onStatusCommandStateChange = vi.fn();
    const manager = new InputManager({
      onStatusCommandStateChange,
    });

    manager.setInputText("/status");
    manager.setCursorPosition(7);
    manager.activateCommandSelector(0);

    manager.handleCommandSelect("status");

    await vi.waitFor(() => {
      expect(onStatusCommandStateChange).toHaveBeenCalledWith(true);
    });

    expect(manager.getShowStatusCommand()).toBe(true);

    manager.setShowStatusCommand(false);
    expect(onStatusCommandStateChange).toHaveBeenCalledWith(false);
    expect(manager.getShowStatusCommand()).toBe(false);
  });

  it("should block input when status command is shown", async () => {
    const manager = new InputManager();
    manager.setShowStatusCommand(true);

    // handleInput should return true (handled) but not change input
    const handled = await manager.handleInput(
      "a",
      { name: "a" } as unknown as import("ink").Key,
      [],
    );
    expect(handled).toBe(true);
    expect(manager.getInputText()).toBe("");
  });
});
