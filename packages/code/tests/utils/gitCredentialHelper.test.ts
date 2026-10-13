import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  GIT_CREDENTIAL_HELPER_FILENAME,
  gitCredentialHelperPath,
  installGitCredentialHelper,
  renderGitCredentialHelper,
  shellQuote,
} from "../../src/utils/gitCredentialHelper.js";

/**
 * Every path expectation in this file is *derived* with `path.join` from this
 * one fake home (and from the filename constant), never written as a literal
 * with `/` in it: the code under test builds paths with `path.join`, so a
 * hard-coded POSIX expectation pins the separator of the machine running the
 * suite instead of the derivation, and fails on Windows (where `path.join`
 * yields `\`). The Windows CI job runs this file too.
 */
const { FAKE_HOME } = vi.hoisted(() => ({ FAKE_HOME: "/tmp/fake-home" }));

/** Mirrors `AuthService.getAuthPath()`: `path.join(homedir(), ".wave", "auth.json")`. */
const AUTH_PATH = path.join(FAKE_HOME, ".wave", "auth.json");
/** Mirrors `path.dirname(AUTH_PATH)` — the directory the helper is installed in. */
const WAVE_DIR = path.dirname(AUTH_PATH);
/** Mirrors `gitCredentialHelperPath()`. */
const SCRIPT_PATH = path.join(WAVE_DIR, GIT_CREDENTIAL_HELPER_FILENAME);

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(FAKE_HOME),
  };
});

vi.mock("fs");
const mockedWriteFile = vi.mocked(fs.writeFileSync);
const mockedChmod = vi.mocked(fs.chmodSync);
const mockedMkdir = vi.mocked(fs.mkdirSync);

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("/home/user/.wave/auth.json")).toBe(
      "'/home/user/.wave/auth.json'",
    );
  });

  it("escapes an embedded single quote instead of breaking out of it", () => {
    expect(shellQuote("/home/o'brien/a.json")).toBe(
      `'/home/o'\\''brien/a.json'`,
    );
  });
});

describe("renderGitCredentialHelper", () => {
  const script = renderGitCredentialHelper("/home/user/.wave/auth.json");

  it("is a POSIX sh script (git execs it through the shebang)", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("takes the auth path as a quoted literal", () => {
    expect(script).toContain("AUTH_FILE='/home/user/.wave/auth.json'");
  });

  it("drains git's request before answering", () => {
    // A helper that exits without reading stdin can be killed by EPIPE.
    expect(script).toContain("input=$(cat 2>/dev/null)");
  });

  it("reads the token fresh from the login store on every call", () => {
    // No copy of the token is baked into the script or the repo config.
    expect(script).toContain('sed -n \'s/.*"SSO_TOKEN"');
    expect(script).not.toMatch(/"SSO_TOKEN"[^$]*\n.*\n.*echo "\$token"/);
  });

  it("stops git outright when there is no credential", () => {
    // quit=true skips the remaining helpers *and* the interactive prompt, so git
    // fails fast instead of hanging on a terminal agent runs don't have.
    expect(script).toContain('echo "quit=true"');
  });

  it("answers with a bearer credential when git advertises authtype", () => {
    expect(script).toContain("*capability\\[\\]=authtype*)");
    expect(script).toContain('echo "capability[]=authtype"');
    expect(script).toContain('echo "authtype=bearer"');
    expect(script).toContain("printf 'credential=%s\\n' \"$token\"");
  });

  it("falls back to basic auth (username=oauth2) otherwise", () => {
    expect(script).toContain('echo "username=oauth2"');
    expect(script).toContain("printf 'password=%s\\n' \"$token\"");
  });
});

describe("gitCredentialHelperPath", () => {
  it("sits next to auth.json so both live with the login state", () => {
    expect(gitCredentialHelperPath()).toBe(SCRIPT_PATH);
  });
});

describe("installGitCredentialHelper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(FAKE_HOME);
  });

  it("writes the script executable and returns the config value", () => {
    const installed = installGitCredentialHelper();

    expect(installed.path).toBe(SCRIPT_PATH);
    // `shellQuote` only wraps the value in single quotes (no platform branch),
    // so the quoted literal can stay literal here.
    expect(installed.command).toBe(`!exec '${SCRIPT_PATH}'`);
    expect(mockedWriteFile).toHaveBeenCalledWith(
      SCRIPT_PATH,
      renderGitCredentialHelper(AUTH_PATH),
      "utf-8",
    );
    expect(mockedChmod).toHaveBeenCalledWith(SCRIPT_PATH, 0o755);
    expect(mockedMkdir).toHaveBeenCalledWith(WAVE_DIR, {
      recursive: true,
    });
  });
});
