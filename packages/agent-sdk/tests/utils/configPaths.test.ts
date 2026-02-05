import { describe, it, expect, vi } from "vitest";
import {
  getUserConfigPath,
  getProjectConfigPath,
  getUserConfigPaths,
  getProjectConfigPaths,
  getAllConfigPaths,
  getExistingConfigPaths,
  getFirstExistingPath,
  getEffectiveConfigPaths,
  hasAnyConfig,
  getConfigurationInfo,
  getPluginsDir,
} from "@/utils/configPaths.js";
import { existsSync } from "fs";
import { join } from "path";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/user"),
}));

describe("configPaths", () => {
  const workdir = "/project";

  it("getUserConfigPath should return legacy path", () => {
    expect(getUserConfigPath()).toBe(
      join("/home/user", ".wave", "settings.json"),
    );
  });

  it("getProjectConfigPath should return legacy path", () => {
    expect(getProjectConfigPath(workdir)).toBe(
      join(workdir, ".wave", "settings.json"),
    );
  });

  it("getUserConfigPaths should return priority paths", () => {
    const paths = getUserConfigPaths();
    expect(paths).toContain(join("/home/user", ".wave", "settings.local.json"));
    expect(paths).toContain(join("/home/user", ".wave", "settings.json"));
  });

  it("getPluginsDir should return plugins directory", () => {
    expect(getPluginsDir()).toBe(join("/home/user", ".wave", "plugins"));
  });

  it("getProjectConfigPaths should return priority paths", () => {
    const paths = getProjectConfigPaths(workdir);
    expect(paths).toContain(join(workdir, ".wave", "settings.local.json"));
    expect(paths).toContain(join(workdir, ".wave", "settings.json"));
  });

  it("getAllConfigPaths should return all paths", () => {
    const result = getAllConfigPaths(workdir);
    expect(result.userPaths).toHaveLength(2);
    expect(result.projectPaths).toHaveLength(2);
    expect(result.allPaths).toHaveLength(4);
  });

  it("getExistingConfigPaths should filter existing paths", () => {
    vi.mocked(existsSync).mockImplementation((path) =>
      path.toString().includes("settings.json"),
    );
    const result = getExistingConfigPaths(workdir);
    expect(result.existingPaths).toHaveLength(2);
    expect(result.existingPaths[0]).toContain("settings.json");
  });

  it("getFirstExistingPath should return first existing path", () => {
    vi.mocked(existsSync).mockImplementation((path) =>
      path.toString().includes("local.json"),
    );
    const paths = ["/path/1.local.json", "/path/2.json"];
    expect(getFirstExistingPath(paths)).toBe("/path/1.local.json");
  });

  it("getEffectiveConfigPaths should return effective paths", () => {
    vi.mocked(existsSync).mockImplementation((path) =>
      path.toString().includes("/project/.wave/settings.json"),
    );
    const result = getEffectiveConfigPaths(workdir);
    expect(result.projectPath).toBe(join(workdir, ".wave", "settings.json"));
    expect(result.effectivePath).toBe(join(workdir, ".wave", "settings.json"));
  });

  it("hasAnyConfig should return true if any config exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(hasAnyConfig(workdir)).toBe(true);
  });

  it("getConfigurationInfo should return comprehensive info", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const info = getConfigurationInfo(workdir);
    expect(info.hasUser).toBe(false);
    expect(info.hasProject).toBe(false);
    expect(info.paths).toHaveLength(4);
  });
});
