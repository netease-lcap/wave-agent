/**
 * Tests for getTelemetryAttributes — user identity resolution for OTEL.
 *
 * Covers SSO authenticated → server user.id, fallback → anonymous ID.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAuthUser = vi.fn().mockReturnValue(undefined);
const mockGetOrCreateAnonymousId = vi.fn().mockReturnValue("anon-id-fallback");

vi.mock("../../src/services/authService.js", () => ({
  AuthService: {
    getInstance: () => ({ getAuthUser: mockGetAuthUser }),
  },
  getOrCreateAnonymousId: () => mockGetOrCreateAnonymousId(),
  __resetAnonymousIdForTesting: vi.fn(),
}));

vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getTelemetryAttributes } from "../../src/telemetry/instrumentation.js";

describe("getTelemetryAttributes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetAuthUser.mockReturnValue(undefined);
    mockGetOrCreateAnonymousId.mockReturnValue("anon-id-fallback");
  });

  it("returns user.id and user.email when SSO authenticated", () => {
    mockGetAuthUser.mockReturnValue({
      id: "auth-user-id",
      email: "user@example.com",
    });

    const attrs = getTelemetryAttributes();
    expect(attrs).toEqual({
      "user.id": "auth-user-id",
      "user.email": "user@example.com",
    });
    expect(mockGetOrCreateAnonymousId).not.toHaveBeenCalled();
  });

  it("returns only user.id when email is absent", () => {
    mockGetAuthUser.mockReturnValue({
      id: "auth-user-id",
    });

    const attrs = getTelemetryAttributes();
    expect(attrs).toEqual({ "user.id": "auth-user-id" });
    expect(mockGetOrCreateAnonymousId).not.toHaveBeenCalled();
  });

  it("falls back to anonymousId when SSO not authenticated", () => {
    mockGetAuthUser.mockReturnValue(undefined);

    const attrs = getTelemetryAttributes();
    expect(attrs).toEqual({ "user.id": "anon-id-fallback" });
    expect(mockGetOrCreateAnonymousId).toHaveBeenCalled();
  });

  it("falls back to anonymousId when AuthService throws", () => {
    mockGetAuthUser.mockImplementation(() => {
      throw new Error("AuthService not initialized");
    });

    const attrs = getTelemetryAttributes();
    expect(attrs).toEqual({ "user.id": "anon-id-fallback" });
    expect(mockGetOrCreateAnonymousId).toHaveBeenCalled();
  });
});
