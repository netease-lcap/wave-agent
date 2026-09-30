import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

vi.mock("../../src/services/remoteSettingsService.js", () => ({
  getRemoteSettingsSync: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  authService: { getSSOToken: vi.fn() },
}));

import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import { getRemoteSettingsSync } from "../../src/services/remoteSettingsService.js";
import { authService } from "../../src/services/authService.js";
import {
  isArtifactEnabled,
  hasArtifactCredentials,
  ARTIFACT_DEFAULT_ENABLED,
} from "../../src/services/artifactAvailability.js";

/** Configure whether the mocked account has an SSO token on disk. */
function setLoggedIn(loggedIn: boolean): void {
  (authService.getSSOToken as Mock).mockReturnValue(
    loggedIn ? "sso-token" : undefined,
  );
}

describe("artifactAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (loadMergedWaveConfig as Mock).mockReturnValue(null);
  });

  it("should default to enabled", () => {
    expect(ARTIFACT_DEFAULT_ENABLED).toBe(true);
  });

  it("should treat an SSO token as the credential predicate", () => {
    setLoggedIn(true);
    expect(hasArtifactCredentials()).toBe(true);
    setLoggedIn(false);
    expect(hasArtifactCredentials()).toBe(false);
  });

  describe("code default (no enableArtifact anywhere)", () => {
    it("should enable when the account is logged in — even without a workdir", () => {
      setLoggedIn(true);
      expect(isArtifactEnabled(undefined)).toBe(true);
      expect(loadMergedWaveConfig).not.toHaveBeenCalled();
    });

    it("should enable when the account is logged in — with a workdir", () => {
      setLoggedIn(true);
      expect(isArtifactEnabled("/test/workdir")).toBe(true);
      expect(loadMergedWaveConfig).toHaveBeenCalledWith("/test/workdir");
    });

    it("should disable when no account is logged in", () => {
      setLoggedIn(false);
      expect(isArtifactEnabled(undefined)).toBe(false);
      expect(isArtifactEnabled("/test/workdir")).toBe(false);
    });
  });

  describe("explicit enableArtifact", () => {
    it("should enable when settings.json sets enableArtifact: true, logged in or not", () => {
      (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: true });

      setLoggedIn(false);
      expect(isArtifactEnabled("/test/workdir")).toBe(true);

      setLoggedIn(true);
      expect(isArtifactEnabled("/test/workdir")).toBe(true);
    });

    it("should disable when settings.json sets enableArtifact: false, logged in or not", () => {
      (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: false });

      setLoggedIn(true);
      expect(isArtifactEnabled("/test/workdir")).toBe(false);

      setLoggedIn(false);
      expect(isArtifactEnabled("/test/workdir")).toBe(false);
    });

    it("should prefer remote managed settings over local settings", () => {
      (getRemoteSettingsSync as Mock).mockReturnValue({ enableArtifact: true });
      (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: false });
      expect(isArtifactEnabled("/test/workdir")).toBe(true);
    });

    it("should follow remote managed settings even when no workdir is given", () => {
      setLoggedIn(true);
      (getRemoteSettingsSync as Mock).mockReturnValue({ enableArtifact: true });
      expect(isArtifactEnabled(undefined)).toBe(true);
      expect(loadMergedWaveConfig).not.toHaveBeenCalled();
    });

    it("should keep a remote enableArtifact: false closed for a logged-in account", () => {
      setLoggedIn(true);
      (getRemoteSettingsSync as Mock).mockReturnValue({
        enableArtifact: false,
      });
      expect(isArtifactEnabled("/test/workdir")).toBe(false);
    });

    it("should turn on a remote enableArtifact: true for an account with no credentials", () => {
      setLoggedIn(false);
      (getRemoteSettingsSync as Mock).mockReturnValue({ enableArtifact: true });
      expect(isArtifactEnabled("/test/workdir")).toBe(true);
    });

    it("should fall back to local settings when remote does not define enableArtifact", () => {
      setLoggedIn(false);
      (getRemoteSettingsSync as Mock).mockReturnValue({ language: "en" });
      (loadMergedWaveConfig as Mock).mockReturnValue({ enableArtifact: true });
      expect(isArtifactEnabled("/test/workdir")).toBe(true);
    });
  });
});
