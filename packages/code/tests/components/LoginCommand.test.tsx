import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { LoginCommand } from "../../src/components/LoginCommand.js";

// Mock authService - must be hoisted
const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: {
    isSSOAuthenticated: vi.fn<() => boolean>(() => false),
    getSSOToken: vi.fn<() => string | undefined>(() => undefined),
    clearAuth: vi.fn<() => void>(),
    login: vi.fn(),
  },
}));

vi.mock("wave-agent-sdk", () => ({
  authService: mockAuthService,
}));

describe("LoginCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService.isSSOAuthenticated.mockReturnValue(false);
    mockAuthService.getSSOToken.mockReturnValue(undefined);
    mockAuthService.login.mockReset();
  });

  it("should render not logged in state initially", () => {
    const { lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    expect(lastFrame()).toContain("SSO Authentication");
    expect(lastFrame()).toContain("Not logged in");
    expect(lastFrame()).toContain("Press Enter to login");
    expect(lastFrame()).toContain("Esc to cancel");
  });

  it("should call onCancel on escape", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<LoginCommand onCancel={onCancel} />);

    stdin.write("\u001b");
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("should show authenticated state when logged in", () => {
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);
    mockAuthService.getSSOToken.mockReturnValue(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token",
    );

    const { lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    expect(lastFrame()).toContain("Authenticated");
    expect(lastFrame()).toContain("eyJhbGciOi...oken");
    expect(lastFrame()).toContain("Press Enter to logout");
  });

  it("should show admin URL when WAVE_ADMIN_URL is set", () => {
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);
    mockAuthService.getSSOToken.mockReturnValue("short-token");
    process.env.WAVE_ADMIN_URL = "https://admin.example.com";

    const { lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    expect(lastFrame()).toContain("Admin URL:");
    expect(lastFrame()).toContain("https://admin.example.com");

    delete process.env.WAVE_ADMIN_URL;
  });

  it("should call clearAuth when Enter is pressed while authenticated", async () => {
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);
    mockAuthService.getSSOToken.mockReturnValue("test-token");

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    // Wait for render
    await vi.waitFor(() => expect(lastFrame()).toContain("Authenticated"));

    stdin.write("\r");

    await vi.waitFor(() =>
      expect(mockAuthService.clearAuth).toHaveBeenCalled(),
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Logged out successfully"),
    );
  });

  it("should show loading state when login starts", async () => {
    // Make login hang so we can observe loading state, and call onAuthUrl
    mockAuthService.login.mockImplementation(
      async ({ onAuthUrl }: { onAuthUrl?: (url: string) => void }) => {
        onAuthUrl?.(
          "https://admin.example.com/api/auth/sso/netease?callback_url=http://127.0.0.1:12345",
        );
        return new Promise<string>(() => {});
      },
    );

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    // Press Enter to start login
    stdin.write("\r");

    // onAuthUrl replaces the initial message
    await vi.waitFor(() =>
      expect(lastFrame()).toContain(
        "Paste the token from your browser URL bar:",
      ),
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Open this URL in your browser:"),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("Token:"));
  });

  it("should show token input field when loading", async () => {
    let resolveLogin: (value: string) => void;
    mockAuthService.login.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    stdin.write("\r");

    await vi.waitFor(() => expect(lastFrame()).toContain("Token:"));
    await vi.waitFor(() => expect(lastFrame()).toContain("..."));

    resolveLogin!("done");
  });

  it("should accumulate token input characters", async () => {
    mockAuthService.login.mockImplementation(
      ({ readToken }: { readToken: () => Promise<string> }) =>
        new Promise<string>((resolve) => {
          readToken().then(resolve);
        }),
    );

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    stdin.write("\r");

    await vi.waitFor(() => expect(lastFrame()).toContain("Token:"));

    // Type some token characters
    stdin.write("abc");
    await vi.waitFor(() => expect(lastFrame()).toContain("abc"));

    stdin.write("def");
    await vi.waitFor(() => expect(lastFrame()).toContain("abcdef"));

    // Submit token
    stdin.write("\r");

    await vi.waitFor(() => expect(mockAuthService.login).toHaveBeenCalled());
  });

  it("should handle backspace in token input", async () => {
    mockAuthService.login.mockImplementation(
      ({ readToken }: { readToken: () => Promise<string> }) =>
        new Promise<string>((resolve) => {
          readToken().then(resolve);
        }),
    );

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Token:"));

    stdin.write("abcd");
    await vi.waitFor(() => expect(lastFrame()).toContain("abcd"));

    // Press backspace
    stdin.write("\u007f");
    await vi.waitFor(() => expect(lastFrame()).toContain("abc"));

    // Submit empty token clears input
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("..."));

    // Type more and submit
    stdin.write("xyz\r");
    await vi.waitFor(() => expect(mockAuthService.login).toHaveBeenCalled());
  });

  it("should cancel on escape during login", async () => {
    mockAuthService.login.mockImplementation(
      ({ readToken }: { readToken: () => Promise<string> }) =>
        new Promise<string>((_resolve, reject) => {
          readToken().then(_resolve).catch(reject);
        }),
    );

    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(<LoginCommand onCancel={onCancel} />);

    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Token:"));

    stdin.write("\u001b");
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("should show error message on login failure", async () => {
    mockAuthService.login.mockRejectedValue(
      new Error("Failed to fetch SSO providers: 500"),
    );

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    stdin.write("\r");

    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Failed to fetch SSO providers: 500"),
    );
  });

  it("should show success message on login completion", async () => {
    mockAuthService.login.mockResolvedValue("new-token");

    const { stdin, lastFrame } = render(<LoginCommand onCancel={vi.fn()} />);

    stdin.write("\r");

    // Will show loading first, then success
    await vi.waitFor(() => expect(lastFrame()).toContain("Login successful"));
  });
});
