import { describe, it, expect, vi, beforeEach } from "vitest";
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
} from "../../src/utils/configPaths.js";
import { join } from "path";
import { homedir } from "os";
import * as fs from "fs";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe("configPaths", () => {
  const workdir = "/test/workdir";
  const home = homedir();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getUserConfigPath returns correct path", () => {
    expect(getUserConfigPath()).toBe(join(home, ".wave", "settings.json"));
  });

  it("getProjectConfigPath returns correct path", () => {
    expect(getProjectConfigPath(workdir)).toBe(
      join(workdir, ".wave", "settings.json"),
    );
  });

  it("getUserConfigPaths returns priority paths", () => {
    const paths = getUserConfigPaths();
    expect(paths).toEqual([
      join(home, ".wave", "settings.local.json"),
      join(home, ".wave", "settings.json"),
    ]);
  });

  it("getProjectConfigPaths returns priority paths", () => {
    const paths = getProjectConfigPaths(workdir);
    expect(paths).toEqual([
      join(workdir, ".wave", "settings.local.json"),
      join(workdir, ".wave", "settings.json"),
    ]);
  });

  it("getPluginsDir returns correct path", () => {
    expect(getPluginsDir()).toBe(join(home, ".wave", "plugins"));
  });

  it("getAllConfigPaths returns all paths", () => {
    const result = getAllConfigPaths(workdir);
    expect(result.userPaths).toEqual(getUserConfigPaths());
    expect(result.projectPaths).toEqual(getProjectConfigPaths(workdir));
    expect(result.allPaths).toHaveLength(4);
  });

  it("getExistingConfigPaths filters existing paths", () => {
    const userLocal = join(home, ".wave", "settings.local.json");
    const projectJson = join(workdir, ".wave", "settings.json");

    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return path === userLocal || path === projectJson;
    });

    const result = getExistingConfigPaths(workdir);
    expect(result.userPaths).toEqual([userLocal]);
    expect(result.projectPaths).toEqual([projectJson]);
    expect(result.existingPaths).toEqual([userLocal, projectJson]);
  });

  it("getFirstExistingPath returns first match", () => {
    const paths = ["path1", "path2", "path3"];
    vi.mocked(fs.existsSync).mockImplementation((path) => path === "path2");

    expect(getFirstExistingPath(paths)).toBe("path2");

    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getFirstExistingPath(paths)).toBeUndefined();
  });

  it("getEffectiveConfigPaths handles precedence", () => {
    const userLocal = join(home, ".wave", "settings.local.json");
    const projectLocal = join(workdir, ".wave", "settings.local.json");

    // Both exist
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return path === userLocal || path === projectLocal;
    });

    let result = getEffectiveConfigPaths(workdir);
    expect(result.userPath).toBe(userLocal);
    expect(result.projectPath).toBe(projectLocal);
    expect(result.effectivePath).toBe(projectLocal); // Project takes precedence

    // Only user exists
    vi.mocked(fs.existsSync).mockImplementation((path) => path === userLocal);
    result = getEffectiveConfigPaths(workdir);
    expect(result.userPath).toBe(userLocal);
    expect(result.projectPath).toBeUndefined();
    expect(result.effectivePath).toBe(userLocal);
  });

  it("hasAnyConfig returns true if any config exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(hasAnyConfig(workdir)).toBe(true);

    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(hasAnyConfig(workdir)).toBe(false);
  });

  it("getConfigurationInfo returns comprehensive info", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const info = getConfigurationInfo(workdir);
    expect(info.hasUser).toBe(false);
    expect(info.hasProject).toBe(false);
    expect(info.paths).toEqual(getAllConfigPaths(workdir).allPaths);
  });
});
