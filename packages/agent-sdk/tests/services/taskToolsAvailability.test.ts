import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import {
  isTaskToolsEnabled,
  TASK_TOOLS_DEFAULT_ENABLED,
  TASK_TOOLS_ENV_VAR,
} from "../../src/services/taskToolsAvailability.js";

const WORKDIR = "/test/workdir";

function withSettingsEnv(value: string) {
  (loadMergedWaveConfig as Mock).mockReturnValue({
    env: { [TASK_TOOLS_ENV_VAR]: value },
  });
}

describe("taskToolsAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[TASK_TOOLS_ENV_VAR];
  });

  afterEach(() => {
    delete process.env[TASK_TOOLS_ENV_VAR];
  });

  it("should default to off", () => {
    expect(TASK_TOOLS_DEFAULT_ENABLED).toBe(false);
  });

  it("should stay off when nothing sets the flag", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
    expect(isTaskToolsEnabled(undefined)).toBe(false);
  });

  it("should turn on when settings.json env sets 1", () => {
    withSettingsEnv("1");
    expect(isTaskToolsEnabled(WORKDIR)).toBe(true);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith(WORKDIR);
  });

  it("should accept true as well as 1", () => {
    withSettingsEnv("true");
    expect(isTaskToolsEnabled(WORKDIR)).toBe(true);
  });

  it("should read 0 and false as off", () => {
    withSettingsEnv("0");
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
    withSettingsEnv("false");
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
  });

  it("should fall back to the process env when settings do not name the flag", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({ env: { OTHER: "x" } });
    process.env[TASK_TOOLS_ENV_VAR] = "1";
    expect(isTaskToolsEnabled(WORKDIR)).toBe(true);
  });

  it("should let settings.json win over the process env", () => {
    withSettingsEnv("0");
    process.env[TASK_TOOLS_ENV_VAR] = "1";
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
  });

  it("should fall through on an unrecognized value instead of throwing", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({
      env: { [TASK_TOOLS_ENV_VAR]: "yes" },
    });
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
  });

  it("should not propagate a failing settings read", () => {
    (loadMergedWaveConfig as Mock).mockImplementation(() => {
      throw new Error("unreadable settings");
    });
    expect(() => isTaskToolsEnabled(WORKDIR)).not.toThrow();
    expect(isTaskToolsEnabled(WORKDIR)).toBe(false);
  });

  it("should ignore the settings file when no workdir is given", () => {
    withSettingsEnv("1");
    expect(isTaskToolsEnabled(undefined)).toBe(false);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });
});
