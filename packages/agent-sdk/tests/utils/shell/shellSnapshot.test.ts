import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getShellSnapshot,
  snapshotShellKind,
} from "../../../src/utils/shell/shellSnapshot.js";
import { execFileSyncHidden } from "../../../src/utils/execFileHidden.js";

/**
 * These cases drive the real module: a real login shell writes a real snapshot
 * file. Nothing is mocked — except `os.homedir()`, which `tests/setup.ts`
 * already replaces for every file (it answers `/tmp`). The rc file has to come
 * from a directory this test owns, so the stub is re-pointed at a fake HOME, and
 * `HOME` is stubbed to the same directory so the login shell's own startup files
 * come from there too instead of from the developer's machine.
 */
const SNAPSHOT_DIR = "wave-shell-snapshots";

/** Every temp dir a test made, removed in `afterEach`. */
const createdDirs: string[] = [];
let tempDir = "";
let fakeHome = "";

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function bashIsAvailable(): boolean {
  try {
    execFileSyncHidden("bash", ["-c", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_BASH = bashIsAvailable();

/** A path as exactly one shell word. */
function quoteWord(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeBashrc(content: string): void {
  fs.writeFileSync(path.join(fakeHome, ".bashrc"), content);
}

/** Names of the snapshots a temp dir holds (`[]` when it holds no dir yet). */
function snapshotFiles(dir: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, SNAPSHOT_DIR)).sort();
  } catch {
    return [];
  }
}

/** Asserts a returned value is a real, non-empty snapshot file; returns it. */
function expectSnapshotFile(
  snapshot: string | undefined,
  dir = tempDir,
): string {
  if (snapshot === undefined) throw new Error("expected a snapshot path");
  expect(fs.existsSync(snapshot)).toBe(true);
  expect(path.dirname(snapshot)).toBe(path.join(dir, SNAPSHOT_DIR));
  expect(path.basename(snapshot)).toMatch(/^snapshot-bash-\d+-\d+-/);
  expect(fs.statSync(snapshot).size).toBeGreaterThan(0);
  return snapshot;
}

describe("snapshotShellKind", () => {
  it("classifies bash and zsh by basename, ignoring case", () => {
    expect(snapshotShellKind("/bin/bash")).toBe("bash");
    expect(snapshotShellKind("/bin/zsh")).toBe("zsh");
    // Windows paths and odd casing go through the same basename check.
    expect(snapshotShellKind("/usr/local/bin/BASH")).toBe("bash");
    expect(snapshotShellKind("/opt/homebrew/bin/Zsh")).toBe("zsh");
  });

  it("leaves every other shell unclassified", () => {
    expect(
      snapshotShellKind("C:\\Program Files\\PowerShell\\powershell.exe"),
    ).toBe(undefined);
    expect(snapshotShellKind("/bin/sh")).toBe(undefined);
    expect(snapshotShellKind("/bin/dash")).toBe(undefined);
    expect(snapshotShellKind("")).toBe(undefined);
  });
});

describe("getShellSnapshot", () => {
  beforeEach(() => {
    tempDir = makeTempDir("wave-snap-test-");
    fakeHome = makeTempDir("wave-snap-home-");
    vi.mocked(os.homedir).mockReturnValue(fakeHome);
    vi.stubEnv("HOME", fakeHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Back to the value `tests/setup.ts` installs, so nothing leaks between cases.
    vi.mocked(os.homedir).mockReturnValue("/tmp");
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves undefined for a shell it does not cover, without spawning", async () => {
    await expect(getShellSnapshot("/bin/sh", tempDir)).resolves.toBe(undefined);

    // Not even the directory: the kind is checked before anything touches disk.
    expect(fs.existsSync(path.join(tempDir, SNAPSHOT_DIR))).toBe(false);
    expect(snapshotFiles(tempDir)).toEqual([]);
  });

  it.skipIf(!HAS_BASH)(
    "captures the rc's functions, options and aliases into a sourceable file",
    { timeout: 30_000 },
    async () => {
      writeBashrc(
        [
          "wave_test_fn() { echo from-fn; }",
          "alias wavealias='echo from-alias'",
          "echo RC_NOISE_STDOUT",
          "echo RC_NOISE_STDERR >&2",
          "",
        ].join("\n"),
      );

      const snapshot = expectSnapshotFile(
        await getShellSnapshot("bash", tempDir),
      );
      const contents = fs.readFileSync(snapshot, "utf8");

      expect(contents).toContain("# Functions");
      expect(contents).toContain("wave_test_fn");
      expect(contents).toContain("# Aliases");
      expect(contents).toContain("wavealias");
      expect(contents).toContain("shopt -s expand_aliases");
      // Regression: filtering set -o for "on" also matched "monitor off"
      // ("m-on-itor") and re-enabled job control, which pushed every
      // backgrounded command into its own process group. Off options must
      // come back as "set +o", so a plain foreground command keeps its
      // leftovers in the shell own group.
      expect(contents).toContain("set +o monitor");
      expect(contents).not.toContain("set -o monitor");
      // The rc's own output belongs to the login shell, never to the snapshot.
      expect(contents).not.toContain("RC_NOISE_STDOUT");
      expect(contents).not.toContain("RC_NOISE_STDERR");

      // And the snapshot is not merely text that looks right: source it in a
      // plain non-interactive shell. A function resolves at call time; an alias
      // is expanded while a command is parsed, so it needs `eval` to be
      // re-read after the snapshot has defined it.
      expect(
        execFileSyncHidden(
          "bash",
          ["-c", `. ${quoteWord(snapshot)} && wave_test_fn`],
          { encoding: "utf8" },
        ),
      ).toBe("from-fn\n");
      expect(
        execFileSyncHidden(
          "bash",
          ["-c", `. ${quoteWord(snapshot)} && eval wavealias`],
          { encoding: "utf8" },
        ),
      ).toBe("from-alias\n");
    },
  );

  it.skipIf(!HAS_BASH)(
    "still builds a snapshot when the user has no rc file",
    { timeout: 30_000 },
    async () => {
      expect(fs.existsSync(path.join(fakeHome, ".bashrc"))).toBe(false);

      const snapshot = expectSnapshotFile(
        await getShellSnapshot("bash", tempDir),
      );

      // A missing rc is the normal case on a fresh account: the dump runs anyway.
      expect(fs.readFileSync(snapshot, "utf8")).toContain("# Options");
      expect(snapshotFiles(tempDir)).toHaveLength(1);
    },
  );

  it.skipIf(!HAS_BASH)(
    "keeps what a failing rc defined instead of giving up",
    { timeout: 30_000 },
    async () => {
      // The rc defines a function and then fails; the snapshot script keeps
      // going (`|| true`), because a half-configured shell still beats a `-c`.
      writeBashrc(["wave_test_fn() { echo from-fn; }", "false", ""].join("\n"));

      const snapshot = expectSnapshotFile(
        await getShellSnapshot("bash", tempDir),
      );

      expect(fs.readFileSync(snapshot, "utf8")).toContain("wave_test_fn");
    },
  );

  it.skipIf(!HAS_BASH)(
    "resolves undefined rather than throwing when the rc kills the shell",
    { timeout: 30_000 },
    async () => {
      // `exit 3` takes the login shell down before anything is written.
      writeBashrc("exit 3\n");

      const snapshot = await getShellSnapshot("bash", tempDir);

      // A failure is not fatal: it must never reject, and a missing snapshot is
      // the documented outcome. Anything else has to be a usable file.
      if (snapshot !== undefined) {
        expectSnapshotFile(snapshot);
      }
      expect(snapshotFiles(tempDir)).toEqual([]);
    },
  );

  it.skipIf(!HAS_BASH)(
    "builds one snapshot per (shell, temp dir) pair",
    { timeout: 30_000 },
    async () => {
      const first = getShellSnapshot("bash", tempDir);
      const second = getShellSnapshot("bash", tempDir);

      // The cache holds the promise itself, so a repeat call is the same task.
      expect(second).toBe(first);

      const [a, b] = await Promise.all([first, second]);
      const snapshot = expectSnapshotFile(a);
      expect(b).toBe(snapshot);
      expect(snapshotFiles(tempDir)).toHaveLength(1);

      // The sandbox's own temp dir gets its own file, not this one.
      const otherDir = makeTempDir("wave-snap-other-");
      const other = expectSnapshotFile(
        await getShellSnapshot("bash", otherDir),
        otherDir,
      );
      expect(other).not.toBe(snapshot);
      expect(snapshotFiles(otherDir)).toHaveLength(1);
      expect(snapshotFiles(tempDir)).toHaveLength(1);
    },
  );
});
