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
  isKnowledgeBaseEnabled,
  KNOWLEDGE_BASE_TOOLS_DEFAULT_ENABLED,
} from "../../src/services/knowledgeBaseAvailability.js";

describe("knowledgeBaseAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to disabled — enterprise documents reach every conversation", () => {
    expect(KNOWLEDGE_BASE_TOOLS_DEFAULT_ENABLED).toBe(false);
  });

  it("should stay disabled when neither layer configures it", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue(null);
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(false);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith("/test/workdir");
  });

  it("should stay disabled with no workdir and no managed value", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue(undefined);
    expect(isKnowledgeBaseEnabled(undefined)).toBe(false);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should enable when local settings.json sets enableKnowledgeBase: true", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue(null);
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableKnowledgeBase: true,
    });
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(true);
  });

  it("should prefer managed settings over local settings", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({
      enableKnowledgeBase: false,
    });
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableKnowledgeBase: true,
    });
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(false);
  });

  it("should let an operator turn it on with no workdir at all", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({
      enableKnowledgeBase: true,
    });
    expect(isKnowledgeBaseEnabled(undefined)).toBe(true);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should fall back to local settings when managed settings omit the key", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue({ language: "zh" });
    (loadMergedWaveConfig as Mock).mockReturnValue({
      enableKnowledgeBase: true,
    });
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(true);
  });

  it("should read a non-boolean value as unset, never as enabled", () => {
    // A hand-edited settings file can hold "true" / 1 / null; none of them may
    // open the capability.
    for (const junk of ["true", 1, null, {}]) {
      (getRemoteSettingsSync as Mock).mockReturnValue({
        enableKnowledgeBase: junk,
      });
      (loadMergedWaveConfig as Mock).mockReturnValue(null);
      expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(false);
    }
  });

  it("should read a settings failure as disabled, never as enabled", () => {
    (getRemoteSettingsSync as Mock).mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(false);
  });

  it("should read a failing local settings read as disabled", () => {
    (getRemoteSettingsSync as Mock).mockReturnValue(null);
    (loadMergedWaveConfig as Mock).mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(isKnowledgeBaseEnabled("/test/workdir")).toBe(false);
  });
});
