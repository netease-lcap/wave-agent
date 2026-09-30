import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

vi.mock("../../src/services/remoteSettingsService.js", () => ({
  getRemoteSettingsSync: vi.fn(),
}));

import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import { getRemoteSettingsSync } from "../../src/services/remoteSettingsService.js";
import {
  isExecEnabled,
  EXEC_DEFAULT_ENABLED,
} from "../../src/services/execAvailability.js";

describe("execAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to disabled", () => {
    expect(EXEC_DEFAULT_ENABLED).toBe(false);
  });

  it("should follow the code default when no workdir is given", () => {
    expect(isExecEnabled(undefined)).toBe(EXEC_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should follow the code default when no config exists for the workdir", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
    expect(isExecEnabled("/test/workdir")).toBe(EXEC_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith("/test/workdir");
  });

  it("should enable when settings.json sets enableExec: true", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableExec: true });
    expect(isExecEnabled("/test/workdir")).toBe(true);
  });

  it("should disable when settings.json sets enableExec: false", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableExec: false });
    expect(isExecEnabled("/test/workdir")).toBe(false);
  });

  it("should prefer remote managed settings over local settings", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({ enableExec: false });
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableExec: true });
    expect(isExecEnabled("/test/workdir")).toBe(false);
  });

  it("should follow remote managed settings even when no workdir is given", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({ enableExec: true });
    expect(isExecEnabled(undefined)).toBe(true);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should fall back to local settings when remote does not define enableExec", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({ language: "en" });
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableExec: true });
    expect(isExecEnabled("/test/workdir")).toBe(true);
  });
});
