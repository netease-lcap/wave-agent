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
  isRemoteControlEnabled,
  REMOTE_CONTROL_DEFAULT_ENABLED,
} from "../../src/services/remoteControlAvailability.js";

describe("remoteControlAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to enabled — dialing stays explicit even though serving is on", () => {
    expect(REMOTE_CONTROL_DEFAULT_ENABLED).toBe(true);
  });

  it("should be enabled with no workdir and no settings", () => {
    expect(isRemoteControlEnabled(undefined)).toBe(true);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should stay enabled when no config exists for the workdir", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
    expect(isRemoteControlEnabled("/test/workdir")).toBe(true);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith("/test/workdir");
  });

  it("should enable when settings.json sets enableRemoteControl: true", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableRemoteControl: true,
    });
    expect(isRemoteControlEnabled("/test/workdir")).toBe(true);
  });

  it("should disable when settings.json sets enableRemoteControl: false", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableRemoteControl: false,
    });
    expect(isRemoteControlEnabled("/test/workdir")).toBe(false);
  });

  it("should prefer remote managed settings over local settings", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({
      enableRemoteControl: false,
    });
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableRemoteControl: true,
    });
    expect(isRemoteControlEnabled("/test/workdir")).toBe(false);
  });

  it("should let an operator turn it on with no workdir at all", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({
      enableRemoteControl: true,
    });
    expect(isRemoteControlEnabled(undefined)).toBe(true);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should fall back to local settings when remote does not define it", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({ language: "en" });
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableRemoteControl: true,
    });
    expect(isRemoteControlEnabled("/test/workdir")).toBe(true);
  });

  it("should read a broken settings file as disabled, never as enabled", () => {
    // The verdict gates an outbound network path; an unreadable config must not
    // open it.
    (loadMergedWaveConfig as Mock).mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(isRemoteControlEnabled("/test/workdir")).toBe(false);
  });
});
