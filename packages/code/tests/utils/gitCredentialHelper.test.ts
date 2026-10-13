import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as fs from "fs";
import {
  GIT_CREDENTIAL_HELPER_FILENAME,
  gitCredentialHelperPath,
  installGitCredentialHelper,
  renderGitCredentialHelper,
  shellQuote,
} from "../../src/utils/gitCredentialHelper.js";

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue("/tmp/fake-home"),
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
    expect(gitCredentialHelperPath()).toBe(
      `/tmp/fake-home/.wave/${GIT_CREDENTIAL_HELPER_FILENAME}`,
    );
  });
});

describe("installGitCredentialHelper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue("/tmp/fake-home");
  });

  it("writes the script executable and returns the config value", () => {
    const installed = installGitCredentialHelper();

    const scriptPath = `/tmp/fake-home/.wave/${GIT_CREDENTIAL_HELPER_FILENAME}`;
    expect(installed.path).toBe(scriptPath);
    expect(installed.command).toBe(`!exec '${scriptPath}'`);
    expect(mockedWriteFile).toHaveBeenCalledWith(
      scriptPath,
      renderGitCredentialHelper("/tmp/fake-home/.wave/auth.json"),
      "utf-8",
    );
    expect(mockedChmod).toHaveBeenCalledWith(scriptPath, 0o755);
    expect(mockedMkdir).toHaveBeenCalledWith("/tmp/fake-home/.wave", {
      recursive: true,
    });
  });
});
