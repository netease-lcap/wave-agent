import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: { getServerUrl: vi.fn() },
}));

/** The two settings layers the switch resolves through, plus a way to make the read fail. */
const layers = vi.hoisted(() => ({
  remote: null as Record<string, unknown> | null,
  local: null as Record<string, unknown> | null,
  localThrows: false,
}));

vi.mock("../../src/services/remoteSettingsService.js", () => ({
  getRemoteSettingsSync: () => layers.remote,
}));

vi.mock("../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: () => {
    if (layers.localThrows) throw new Error("settings.json is unreadable");
    return layers.local;
  },
}));

import { authService } from "../../src/services/authService.js";
import {
  WEB_SEARCH_DEFAULT_ENABLED,
  __resetWebSearchAvailabilityForTesting,
  isWebSearchAvailable,
  isWebSearchEnabledBySettings,
  markWebSearchUnsupported,
} from "../../src/services/webSearchAvailability.js";

beforeEach(() => {
  vi.clearAllMocks();
  __resetWebSearchAvailabilityForTesting();
  layers.remote = null;
  layers.local = null;
  layers.localThrows = false;
});

describe("web search availability", () => {
  it("is available until a 404 says otherwise", () => {
    (authService.getServerUrl as Mock).mockReturnValue("https://a.test");
    expect(isWebSearchAvailable()).toBe(true);
  });

  it("remembers the verdict for the server that gave it", () => {
    (authService.getServerUrl as Mock).mockReturnValue("https://a.test");
    markWebSearchUnsupported();
    expect(isWebSearchAvailable()).toBe(false);
  });

  it("does not carry the verdict over to another server", () => {
    // The login state follows the server URL, so another deployment may well
    // have the capability — and it must be probed again rather than assumed
    // absent.
    (authService.getServerUrl as Mock).mockReturnValue("https://a.test");
    markWebSearchUnsupported();

    (authService.getServerUrl as Mock).mockReturnValue("https://b.test");
    expect(isWebSearchAvailable()).toBe(true);

    (authService.getServerUrl as Mock).mockReturnValue("https://a.test");
    expect(isWebSearchAvailable()).toBe(false);
  });

  it("is idempotent (a stale plugin reference can call it twice)", () => {
    (authService.getServerUrl as Mock).mockReturnValue("https://a.test");
    markWebSearchUnsupported();
    expect(() => markWebSearchUnsupported()).not.toThrow();
    expect(isWebSearchAvailable()).toBe(false);
  });
});

describe("the enableWebSearch switch", () => {
  it("defaults to off — the deployments that want it opt in", () => {
    expect(WEB_SEARCH_DEFAULT_ENABLED).toBe(false);
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("takes a managed false from the server", () => {
    layers.remote = { enableWebSearch: false };
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("lets the managed layer win over local files in both directions", () => {
    layers.remote = { enableWebSearch: true };
    layers.local = { enableWebSearch: false };
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(true);

    layers.remote = { enableWebSearch: false };
    layers.local = { enableWebSearch: true };
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("falls through to the local layer when the managed one says nothing", () => {
    layers.local = { enableWebSearch: false };
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("reads a non-boolean as 'this layer says nothing' instead of coercing", () => {
    // A hand-edited or older/newer payload must not be able to flip the switch.
    layers.remote = { enableWebSearch: "true" };
    layers.local = { enableWebSearch: 1 };
    // A coercion would read the string as on; saying nothing lands on the
    // code default instead.
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("falls back to the default when the settings file cannot be read", () => {
    layers.localThrows = true;
    expect(() => isWebSearchEnabledBySettings("/test/workdir")).not.toThrow();
    expect(isWebSearchEnabledBySettings("/test/workdir")).toBe(false);
  });

  it("still honours the managed layer when no workdir was handed in", () => {
    layers.remote = { enableWebSearch: false };
    expect(isWebSearchEnabledBySettings()).toBe(false);
    layers.remote = null;
    expect(isWebSearchEnabledBySettings()).toBe(false);
  });
});
