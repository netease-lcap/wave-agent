import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { hostLog } from "../src/main/hostLog.js";

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
    // The desktop test config disables logger IO globally — re-enable it here.
    process.env = { ...originalEnv, DISABLE_LOGGER_IO: "false" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const writtenLine = () =>
    vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;

  it("should write a leveled line to desktop.log", () => {
    hostLog.warn("something happened");

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("desktop.log"),
      expect.stringMatching(/^\[.*\] \[WARN\] something happened\n$/),
    );
  });

  it("should write a multi-line block with one header line", () => {
    hostLog.block("WARN", [
      "renderer unresponsive: JS stack samples",
      "<2> at spin (chat.js:1:2)",
      "Total Samples: 2",
    ]);

    const text = fs.appendFileSync.mock.calls[0][1] as string;

    // Header is timestamped/leveled; the payload keeps its own line breaks so a
    // stack block stays readable (unlike the single-line helpers, which flatten).
    expect(text).toMatch(
      /^\[.*\] \[WARN\] renderer unresponsive: JS stack samples\n<2> at spin \(chat\.js:1:2\)\nTotal Samples: 2\n$/,
    );
  });

  it("should not leave a blank line after a single-line block", () => {
    // Renderer memory readings are one-line blocks; a stray trailing newline
    // put an empty line between every reading in desktop.log.
    hostLog.block("INFO", ["renderer memory pid=1 workingSet=1MB peak=2MB"]);

    const text = fs.appendFileSync.mock.calls[0][1] as string;

    expect(text).toMatch(
      /^\[.*\] \[INFO\] renderer memory pid=1 workingSet=1MB peak=2MB\n$/,
    );
  });

  it("should not write an empty block", () => {
    hostLog.block("WARN", []);

    expect(fs.appendFileSync).not.toHaveBeenCalled();
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
