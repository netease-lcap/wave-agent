/**
 * Real-git tests for the generated credential helper.
 *
 * tests/utils/gitCredentialHelper.test.ts pins the script's *text*; only a real
 * git can tell whether that text actually satisfies the credential protocol
 * (which attribute names a given git version accepts, whether `quit=true`
 * really skips the prompt, whether `git clone -c credential.helper=…` persists
 * what we think). So this suite writes the rendered script to a temp dir and
 * drives it through `git credential fill` and a real clone.
 *
 * Lives under tests/integration/ (excluded from the unit gate, picked up by
 * `pnpm run test:integration`) because it shells out to git.
 *
 * Skipped on Windows: the script is a POSIX `sh` file, and the way git actually
 * runs it there (through the MSYS sh bundled with Git for Windows) cannot be
 * reproduced by exec'ing the file from Node.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  renderGitCredentialHelper,
  shellQuote,
} from "../../src/utils/gitCredentialHelper.js";

const POSIX_ONLY = process.platform === "win32";

/** The token the helper is expected to hand back, read from `auth.json`. */
const TOKEN = "sso-token-v1";

let root: string;
let authPath: string;
let scriptPath: string;

function writeAuth(token: string | undefined) {
  fs.writeFileSync(
    authPath,
    JSON.stringify(
      token === undefined ? { user: { id: "u1" } } : { SSO_TOKEN: token },
      null,
      2,
    ),
    "utf-8",
  );
}

/**
 * `git credential fill` with the *installed* helper command — the same two
 * `-c` entries the deep-link clone uses (empty first, ours second).
 */
function gitCredentialFill(
  request: string,
  options?: { expectFailure?: boolean },
): string {
  const args = [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=!exec ${shellQuote(scriptPath)}`,
    "credential",
    "fill",
  ];
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      input: request,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    if (!options?.expectFailure) throw error;
    const stderr = (error as { stderr?: string }).stderr ?? "";
    return `(failed) ${stderr}`;
  }
}

/** Run the script itself, so a test can assert its exact stdout. */
function runScript(request: string): string {
  return execFileSync(scriptPath, [], {
    encoding: "utf8",
    input: request,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe.skipIf(POSIX_ONLY)("git credential helper (real git)", () => {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wave-cred-helper-"));
    authPath = path.join(root, ".wave", "auth.json");
    scriptPath = path.join(root, ".wave", "git-credential-wave");
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(scriptPath, renderGitCredentialHelper(authPath), "utf-8");
    fs.chmodSync(scriptPath, 0o755);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("authenticates git from the login store", () => {
    writeAuth(TOKEN);
    const output = gitCredentialFill(
      "protocol=https\nhost=git.example.com\n\n",
    );
    expect(output).toContain("username=oauth2");
    expect(output).toContain(`password=${TOKEN}`);
  });

  it("re-reads the token on every request, so a refresh is picked up", () => {
    writeAuth(TOKEN);
    expect(
      gitCredentialFill("protocol=https\nhost=git.example.com\n\n"),
    ).toContain(`password=${TOKEN}`);

    // Simulate the CLI refreshing the login store between two git operations.
    writeAuth("sso-token-v2");
    expect(
      gitCredentialFill("protocol=https\nhost=git.example.com\n\n"),
    ).toContain("password=sso-token-v2");
  });

  it("answers with a bearer credential when git announces authtype", () => {
    writeAuth(TOKEN);
    const output = runScript(
      "capability[]=authtype\nprotocol=https\nhost=git.example.com\n\n",
    );
    expect(output).toContain("capability[]=authtype");
    expect(output).toContain("authtype=bearer");
    expect(output).toContain(`credential=${TOKEN}`);
    expect(output).not.toContain("password=");
  });

  it("fails fast without hanging when no credential is stored", () => {
    writeAuth(undefined);
    // The helper refuses outright …
    expect(runScript("protocol=https\nhost=git.example.com\n\n").trim()).toBe(
      "quit=true",
    );
    // … and git therefore never reaches an interactive prompt (there is no
    // terminal when the agent runs git). GIT_TERMINAL_PROMPT=0 is set, so a
    // hang would show up as a test timeout.
    const output = gitCredentialFill(
      "protocol=https\nhost=git.example.com\n\n",
      {
        expectFailure: true,
      },
    );
    expect(output).toContain("(failed)");
  });

  it("persists the helper command — and no credential — into the clone's config", () => {
    const origin = path.join(root, "origin.git");
    const target = path.join(root, "clone");
    execFileSync("git", ["init", "--bare", "-q", origin]);

    execFileSync(
      "git",
      [
        "clone",
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=!exec ${shellQuote(scriptPath)}`,
        "--",
        origin,
        target,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    // `--get-all` prints one line per entry, and the first entry's value is
    // empty — strip only the trailing newline, or `trim()` eats that entry.
    const helpers = execFileSync(
      "git",
      ["config", "--get-all", "credential.helper"],
      { cwd: target, encoding: "utf8" },
    )
      .replace(/\n+$/, "")
      .split("\n");
    // Order is the contract: the empty entry resets whatever the machine's
    // system/global config inherited, ours is the only one left.
    expect(helpers[0]).toBe("");
    expect(helpers[1]).toBe(`!exec ${shellQuote(scriptPath)}`);

    writeAuth(TOKEN);
    expect(
      fs.readFileSync(path.join(target, ".git", "config"), "utf-8"),
    ).not.toContain(TOKEN);
  });
});
