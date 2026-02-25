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
    vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("mkdir failed"));
    await expect(planManager.getOrGeneratePlanFilePath()).rejects.toThrow(
      "mkdir failed",
    );
  });

  it("should return the same path when called with the same seed", async () => {
    const planManager = new PlanManager();
    const seed = "test-seed";
    const result1 = await planManager.getOrGeneratePlanFilePath(seed);
    const result2 = await planManager.getOrGeneratePlanFilePath(seed);

    expect(result1.path).toBe(result2.path);
    expect(result1.name).toBe(result2.name);
  });

  it("should return different paths when called with different seeds", async () => {
    const planManager = new PlanManager();
    const result1 = await planManager.getOrGeneratePlanFilePath("seed-1");
    const result2 = await planManager.getOrGeneratePlanFilePath("seed-2");

    expect(result1.path).not.toBe(result2.path);
    expect(result1.name).not.toBe(result2.name);
  });

  it("should remove existing plan file on first generation but not on re-entry", async () => {
    const planManager = new PlanManager();
    const seed = "test-seed";

    // First call
    await planManager.getOrGeneratePlanFilePath(seed);
    expect(fs.unlink).toHaveBeenCalledTimes(1);

    // Second call (re-entry)
    await planManager.getOrGeneratePlanFilePath(seed);
    expect(fs.unlink).toHaveBeenCalledTimes(1); // Still 1

    // Different seed
    await planManager.getOrGeneratePlanFilePath("different-seed");
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it("should ignore ENOENT when removing existing plan file", async () => {
    const planManager = new PlanManager();
    vi.mocked(fs.unlink).mockRejectedValueOnce({ code: "ENOENT" });

    await expect(
      planManager.getOrGeneratePlanFilePath(),
    ).resolves.toBeDefined();
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
