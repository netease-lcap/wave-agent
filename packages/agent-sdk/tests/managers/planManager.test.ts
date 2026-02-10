import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanManager } from "../../src/managers/planManager.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs/promises");
vi.mock("node:os");

describe("PlanManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue("/home/user");
  });

  it("should generate a plan file path with a random name", async () => {
    const planManager = new PlanManager();
    const { path: filePath, name } =
      await planManager.getOrGeneratePlanFilePath();

    // Use path.join to be cross-platform in tests
    const expectedDir = path.join("/home/user", ".wave", "plans");

    expect(filePath).toContain(expectedDir);
    expect(filePath).toMatch(/\.md$/);
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(fs.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
  });

  it("should return the correct plan directory", () => {
    const planManager = new PlanManager();
    const expectedDir = path.join("/home/user", ".wave", "plans");
    expect(planManager.getPlanDir()).toBe(expectedDir);
  });

  it("should throw error if mkdir fails", async () => {
    const planManager = new PlanManager();
    vi.mocked(fs.mkdir).mockRejectedValue(new Error("mkdir failed"));
    await expect(planManager.getOrGeneratePlanFilePath()).rejects.toThrow(
      "mkdir failed",
    );
  });
});
