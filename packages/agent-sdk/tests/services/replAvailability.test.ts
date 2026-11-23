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
  isReplEnabled,
  isReplCoreToolsEnabled,
  REPL_DEFAULT_ENABLED,
  REPL_CORE_TOOLS_DEFAULT_ENABLED,
} from "../../src/services/replAvailability.js";

const WORKDIR = "/test/workdir";

function remote(settings: unknown): void {
  (getRemoteSettingsSync as Mock).mockReturnValue(settings);
}

function local(settings: unknown): void {
  (loadMergedWaveConfig as Mock).mockReturnValue(settings);
}

describe("replAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to enabled", () => {
    expect(REPL_DEFAULT_ENABLED).toBe(true);
  });

  it("should default the core-tool switch to off", () => {
    expect(REPL_CORE_TOOLS_DEFAULT_ENABLED).toBe(false);
  });

  it("should follow the code default when no workdir is given", () => {
    expect(isReplEnabled(undefined)).toBe(REPL_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should follow the code default when no config exists for the workdir", () => {
    local(null);
    expect(isReplEnabled(WORKDIR)).toBe(REPL_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith(WORKDIR);
  });

  it("should enable when settings.json sets enableRepl: true", () => {
    local({ enableRepl: true });
    expect(isReplEnabled(WORKDIR)).toBe(true);
  });

  it("should disable when settings.json sets enableRepl: false", () => {
    local({ enableRepl: false });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should still accept the retired enableExec key", () => {
    // A settings file written before the rename has to keep working, both ways.
    local({ enableExec: true });
    expect(isReplEnabled(WORKDIR)).toBe(true);
    local({ enableExec: false });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should prefer enableRepl over enableExec within the local layer", () => {
    local({ enableRepl: true, enableExec: false });
    expect(isReplEnabled(WORKDIR)).toBe(true);
    local({ enableRepl: false, enableExec: true });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should prefer remote managed settings over local settings", () => {
    remote({ enableRepl: false });
    local({ enableRepl: true });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should prefer the remote current key over the remote retired key", () => {
    remote({ enableRepl: true, enableExec: false });
    expect(isReplEnabled(WORKDIR)).toBe(true);
    remote({ enableRepl: false, enableExec: true });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should let a remote retired key beat a local current key", () => {
    // The layer wins over the spelling: an admin push is the authority, and it
    // names whichever key its version knows.
    remote({ enableExec: false });
    local({ enableRepl: true });
    expect(isReplEnabled(WORKDIR)).toBe(false);
  });

  it("should follow remote managed settings even when no workdir is given", () => {
    remote({ enableRepl: true });
    expect(isReplEnabled(undefined)).toBe(true);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should fall back to local settings when remote defines neither key", () => {
    remote({ language: "en" });
    local({ enableRepl: true });
    expect(isReplEnabled(WORKDIR)).toBe(true);
  });

  it("should treat a non-boolean as unset rather than coercing it", () => {
    // A malformed remote push must not be able to flip the switch: the local layer
    // still decides.
    remote({ enableRepl: "false" });
    local({ enableRepl: true });
    expect(isReplEnabled(WORKDIR)).toBe(true);
  });

  describe("isReplCoreToolsEnabled", () => {
    it("should default to off", () => {
      local(null);
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(false);
      expect(isReplCoreToolsEnabled(undefined)).toBe(false);
    });

    it("should follow settings.json", () => {
      local({ enableReplCoreTools: true });
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(true);
    });

    it("should prefer remote managed settings over local settings", () => {
      remote({ enableReplCoreTools: false });
      local({ enableReplCoreTools: true });
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(false);
    });

    it("should be off whenever the master switch is off", () => {
      // Spec 场景 9: those seven tools must stay declared flat rather than end up
      // neither in `tools[]` nor reachable.
      local({ enableRepl: false, enableReplCoreTools: true });
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(false);
    });

    it("should be off when a remote push disables the master switch", () => {
      remote({ enableRepl: false });
      local({ enableReplCoreTools: true });
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(false);
    });

    it("should be off when the retired key disables the master switch", () => {
      local({ enableExec: false, enableReplCoreTools: true });
      expect(isReplCoreToolsEnabled(WORKDIR)).toBe(false);
    });
  });
});
