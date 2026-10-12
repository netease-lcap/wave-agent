import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { hostLog } from "../src/hostLog.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe("hostLog", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    // The vscode test config disables logger IO globally — re-enable it here.
    process.env = { ...originalEnv, DISABLE_LOGGER_IO: "false" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const writtenLine = () =>
    vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;

  it("should write a leveled line to vscode.log", () => {
    hostLog.warn("something happened");

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("vscode.log"),
      expect.stringMatching(/^\[.*\] \[WARN\] something happened\n$/),
    );
  });

  it("should keep the cause chain of an error nested in a payload", () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    const networkError = new TypeError("fetch failed");
    Object.defineProperty(networkError, "cause", { value: cause });

    hostLog.error("request failed", {
      model: "deepseek-flash",
      error: networkError,
    });

    const line = writtenLine();

    expect(line).not.toContain('"error":{}');
    expect(line).toContain('"name":"TypeError"');
    expect(line).toContain('"message":"fetch failed"');
    expect(line).toContain('"code":"SELF_SIGNED_CERT_IN_CHAIN"');
  });
});
