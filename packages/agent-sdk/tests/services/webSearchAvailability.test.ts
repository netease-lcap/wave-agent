import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: { getServerUrl: vi.fn() },
}));

import { authService } from "../../src/services/authService.js";
import {
  __resetWebSearchAvailabilityForTesting,
  isWebSearchAvailable,
  markWebSearchUnsupported,
} from "../../src/services/webSearchAvailability.js";

beforeEach(() => {
  vi.clearAllMocks();
  __resetWebSearchAvailabilityForTesting();
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
