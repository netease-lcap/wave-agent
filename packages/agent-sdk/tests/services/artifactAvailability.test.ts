import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import {
  isArtifactEnabled,
  ARTIFACT_DEFAULT_ENABLED,
} from "../../src/services/artifactAvailability.js";

describe("artifactAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to disabled while the frame backend is not live", () => {
    expect(ARTIFACT_DEFAULT_ENABLED).toBe(false);
  });

  it("should follow the code default when no workdir is given", () => {
    expect(isArtifactEnabled(undefined)).toBe(ARTIFACT_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("should follow the code default when no config exists for the workdir", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
    expect(isArtifactEnabled("/test/workdir")).toBe(ARTIFACT_DEFAULT_ENABLED);
    expect(loadMergedWaveConfig).toHaveBeenCalledWith("/test/workdir");
  });

  it("should enable when settings.json sets enableArtifact: true", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: true });
    expect(isArtifactEnabled("/test/workdir")).toBe(true);
  });

  it("should disable when settings.json sets enableArtifact: false", () => {
    (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: false });
    expect(isArtifactEnabled("/test/workdir")).toBe(false);
  });
});
