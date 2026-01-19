import { describe, it, expect, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";

describe("PermissionManager Plan Mode", () => {
  let permissionManager: PermissionManager;
  const planFilePath = "/home/user/.wave/plans/gentle-breeze.md";

  beforeEach(() => {
    permissionManager = new PermissionManager({
      planFilePath,
      workdir: "/home/user/project",
    });
  });

  it("should block Bash commands in plan mode", async () => {
    const context = permissionManager.createContext("Bash", "plan", undefined, {
      command: "ls",
    });
    const decision = await permissionManager.checkPermission(context);
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("Bash commands are not allowed");
  });

  it("should block Delete operations in plan mode", async () => {
    const context = permissionManager.createContext(
      "Delete",
      "plan",
      undefined,
      {
        target_file: "/home/user/project/file.txt",
      },
    );
    const decision = await permissionManager.checkPermission(context);
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("Delete operations are not allowed");
  });

  it("should allow Edit to the plan file in plan mode", async () => {
    const context = permissionManager.createContext("Edit", "plan", undefined, {
      file_path: planFilePath,
    });
    const decision = await permissionManager.checkPermission(context);
    expect(decision.behavior).toBe("allow");
  });

  it("should block Edit to non-plan files in plan mode", async () => {
    const context = permissionManager.createContext("Edit", "plan", undefined, {
      file_path: "/home/user/project/src/index.ts",
    });
    const decision = await permissionManager.checkPermission(context);
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain(
      "only allowed to edit the designated plan file",
    );
  });

  it("should allow Read operations in plan mode", async () => {
    const context = permissionManager.createContext("Read", "plan", undefined, {
      file_path: "/home/user/project/src/index.ts",
    });
    const decision = await permissionManager.checkPermission(context);
    expect(decision.behavior).toBe("allow");
  });
});
