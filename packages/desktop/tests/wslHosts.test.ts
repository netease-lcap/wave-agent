import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The WSL host's pure surface (spec: docs/specs/desktop/desktop-wsl.md). The
 * process-spawning half (`listWslDistros` → `wsl.exe --list --verbose`) is
 * exercised through the `spawn` mock so the parse preflight — the only thing
 * standing between a user and an actionable error — is covered too.
 */
const h = vi.hoisted(() => ({
  stdout: Buffer.alloc(0),
  exitCode: 0,
  spawnCalls: [] as Array<{ file: string; args: string[] }>,
  emitError: false,
}));

vi.mock("child_process", () => ({
  // sshHosts.ts (imported for LOCAL_HOST/shellQuote) promisifies execFile at
  // module scope; it is never called from the WSL paths under test.
  execFile: vi.fn(),
  spawn: vi.fn((file: string, args: string[]) => {
    h.spawnCalls.push({ file, args });
    const listeners = new Map<string, Array<(arg?: unknown) => void>>();
    const on = (event: string, cb: (arg?: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return undefined;
    };
    const child = {
      stdout: { on: (_e: string, cb: (d: Buffer) => void) => cb(h.stdout) },
      stderr: { on: () => undefined },
      on,
      once: on,
      kill: () => undefined,
    };
    // Resolve on the next tick so the caller has subscribed to `exit`.
    setTimeout(() => {
      if (h.emitError) {
        for (const cb of listeners.get("error") ?? []) {
          cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
        }
        return;
      }
      for (const cb of listeners.get("exit") ?? []) cb(h.exitCode);
    }, 0);
    return child;
  }),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
}));

import {
  assertWslDistroReady,
  buildWslCliSpawnSpec,
  buildWslRawSpec,
  decodeWslOutput,
  getWslLoginPath,
  hostDisplayLabel,
  isWslHost,
  isWslSupportedPlatform,
  listWslDistros,
  parseWslDistroList,
  parseWslHostId,
  parseWslLoginPath,
  resetWslLoginPathCache,
  resetWslShellCache,
  wslHostId,
  wslUncPath,
  withWslLoginShell,
} from "../src/main/wslHosts";

beforeEach(() => {
  h.stdout = Buffer.alloc(0);
  h.exitCode = 0;
  h.spawnCalls.length = 0;
  h.emitError = false;
  resetWslShellCache();
  resetWslLoginPathCache();
});

/**
 * `listWslDistros` short-circuits off Windows (a mac/Linux box has no WSL
 * group at all), so the cases that cover the Windows path — spawn, parse,
 * preflight errors — pin the platform instead of silently passing as "returns
 * []" on Linux CI.
 */
const realPlatform = process.platform;
function pinWindowsPlatform(): void {
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
}
function unpinPlatform(): void {
  Object.defineProperty(process, "platform", {
    value: realPlatform,
    configurable: true,
  });
}

describe("host identity", () => {
  it("round-trips a distro through the host id", () => {
    expect(wslHostId("Ubuntu-24.04")).toBe("wsl:Ubuntu-24.04");
    expect(parseWslHostId("wsl:Ubuntu-24.04")).toBe("Ubuntu-24.04");
    expect(isWslHost("wsl:Ubuntu-24.04")).toBe(true);
  });

  it("never confuses local or an ssh host with a distro", () => {
    expect(parseWslHostId("local")).toBeNull();
    expect(parseWslHostId("dev-box")).toBeNull();
    // A distro named "local" must not read as the local sentinel either.
    expect(parseWslHostId("wsl:")).toBeNull();
    expect(isWslHost("wsl:")).toBe(false);
    expect(isWslHost("local")).toBe(false);
  });

  it("labels the three host kinds for the picker, the panes and the sidebar", () => {
    expect(hostDisplayLabel("local")).toBe("本地");
    expect(hostDisplayLabel("wsl:Ubuntu-24.04")).toBe("Ubuntu-24.04 (WSL)");
    expect(hostDisplayLabel("dev-box")).toBe("dev-box");
  });

  it("is Windows-only", () => {
    expect(isWslSupportedPlatform()).toBe(process.platform === "win32");
  });
});

describe("decodeWslOutput", () => {
  it("decodes UTF-16LE output (BOM form)", () => {
    const text = "  NAME  STATE  VERSION\r\n* Ubuntu  Running  2\r\n";
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, "utf16le"),
    ]);
    expect(decodeWslOutput(buf)).toBe(text);
  });

  it("decodes UTF-16LE output with no BOM (NUL byte per ASCII char)", () => {
    const text = "Debian  Stopped  2\n";
    expect(decodeWslOutput(Buffer.from(text, "utf16le"))).toBe(text);
  });

  it("decodes UTF-8 output (WSL_UTF8=1) and strips the BOM", () => {
    const text = "Ubuntu  Running  2\n";
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(text, "utf8"),
    ]);
    expect(decodeWslOutput(buf)).toBe(text);
  });
});

describe("parseWslDistroList", () => {
  const LIST = [
    "  NAME                   STATE           VERSION",
    "* Ubuntu-24.04          Running         2",
    "  Debian                 Stopped         2",
    "  Ubuntu 20.04 LTS       Stopped         2",
    "  Legacy                 Stopped         1",
    "",
  ].join("\r\n");

  it("reads name/state/version and the default marker", () => {
    expect(parseWslDistroList(LIST)).toEqual([
      { name: "Ubuntu-24.04", version: 2, isDefault: true, running: true },
      { name: "Debian", version: 2, isDefault: false, running: false },
      {
        name: "Ubuntu 20.04 LTS",
        version: 2,
        isDefault: false,
        running: false,
      },
      { name: "Legacy", version: 1, isDefault: false, running: false },
    ]);
  });

  it("keeps spaces inside a distro name and drops the fixed-width padding", () => {
    const [distro] = parseWslDistroList(
      "  NAME  STATE  VERSION\n  Ubuntu  24.04   LTS    Running   2\n",
    );
    expect(distro.name).toBe("Ubuntu  24.04   LTS");
  });

  it("tolerates leftover NUL padding from a UTF-16 read", () => {
    const list = "  NAME  STATE  VERSION\n  Debian  Running  2\u0000\n\u0000";
    expect(parseWslDistroList(list).map((d) => d.name)).toEqual(["Debian"]);
  });

  it("ignores a header-only or garbage listing", () => {
    expect(parseWslDistroList("  NAME  STATE  VERSION\n")).toEqual([]);
    expect(parseWslDistroList("")).toEqual([]);
  });

  it("de-duplicates a distro that appears twice", () => {
    const list =
      "  NAME  STATE  VERSION\n  Debian  Running  2\n  debian  Stopped  2\n";
    expect(parseWslDistroList(list)).toHaveLength(1);
  });
});

describe("listWslDistros", () => {
  beforeEach(pinWindowsPlatform);
  afterEach(unpinPlatform);

  it("spawns wsl.exe with the UTF-8 flag and parses its output", async () => {
    h.stdout = Buffer.from(
      "  NAME  STATE  VERSION\r\n  Debian  Running  2\r\n",
    );
    const distros = await listWslDistros();
    expect(h.spawnCalls[0].args).toEqual(["--list", "--verbose"]);
    expect(distros.map((d) => d.name)).toEqual(["Debian"]);
  });

  it("returns [] when wsl.exe fails (nothing to show in the picker)", async () => {
    h.exitCode = 1;
    expect(await listWslDistros()).toEqual([]);
  });

  it("returns [] when wsl.exe cannot be spawned at all", async () => {
    h.emitError = true;
    expect(await listWslDistros()).toEqual([]);
  });
});

describe("assertWslDistroReady (preflight)", () => {
  beforeEach(pinWindowsPlatform);
  afterEach(unpinPlatform);

  it("accepts an installed WSL 2 distro, case-insensitively", async () => {
    h.stdout = Buffer.from(
      "  NAME  STATE  VERSION\n  Ubuntu-24.04  Running  2\n",
    );
    const distro = await assertWslDistroReady("ubuntu-24.04");
    expect(distro.version).toBe(2);
  });

  it("refuses WSL 1 with the conversion command, not a 'not installed' lie", async () => {
    h.stdout = Buffer.from("  NAME  STATE  VERSION\n  Legacy  Stopped  1\n");
    await expect(assertWslDistroReady("Legacy")).rejects.toThrow(
      /WSL 1[\s\S]*wsl --set-version Legacy 2/,
    );
  });

  it("names a missing distro and points at wsl --list", async () => {
    h.stdout = Buffer.from("  NAME  STATE  VERSION\n  Debian  Stopped  2\n");
    await expect(assertWslDistroReady("Ubuntu")).rejects.toThrow(
      /「Ubuntu」不存在[\s\S]*wsl --list/,
    );
  });

  it("explains both causes when no distro can be read at all", async () => {
    h.stdout = Buffer.from("");
    await expect(assertWslDistroReady("Ubuntu")).rejects.toThrow(
      /wsl --install[\s\S]*wsl --status/,
    );
  });
});

describe("wslUncPath", () => {
  it("maps an absolute POSIX path onto the share", () => {
    expect(wslUncPath("Ubuntu", "/home/me/repo/a.md")).toBe(
      "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\a.md",
    );
  });

  it("rejects anything the share cannot express", () => {
    expect(wslUncPath("Ubuntu", "home/me")).toBeNull();
    expect(wslUncPath("Ubuntu", "/home/../etc/passwd")).toBeNull();
    expect(wslUncPath("Ubuntu", "/home\\me")).toBeNull();
  });
});

describe("buildWslRawSpec", () => {
  it("runs the command through sh without a login shell", () => {
    const spec = buildWslRawSpec("Ubuntu", "tar -xf -");
    expect(spec.args).toEqual(["-d", "Ubuntu", "-e", "sh", "-c", "tar -xf -"]);
    expect(spec.file).toMatch(/wsl\.exe$/);
  });
});

describe("parseWslLoginPath", () => {
  it("reads the login shell's PATH from the probe", () => {
    expect(
      parseWslLoginPath("\nWAVE_WSL_PATH=/home/me/.local/bin:/usr/bin:/bin\n"),
    ).toBe("/home/me/.local/bin:/usr/bin:/bin");
  });

  it("ignores an rc banner printed before the answer", () => {
    expect(
      parseWslLoginPath(
        'To run a command as administrator (user "root"), use "sudo <command>".\n' +
          'See "man sudo_root" for details.\n\n' +
          "WAVE_WSL_PATH=/home/me/.local/bin:/usr/bin\n",
      ),
    ).toBe("/home/me/.local/bin:/usr/bin");
  });

  it("returns an empty PATH when the shell printed no marker at all", () => {
    expect(parseWslLoginPath("/bin/bash: no such file\n")).toBe("");
  });
});

describe("login PATH + CLI spawn spec", () => {
  const BASHRC_BANNER =
    'To run a command as administrator (user "root"), use "sudo <command>".\n' +
    'See "man sudo_root" for details.\n\n';
  const RUNTIME_NODE = "/home/me/.wave/runtime/node/bin/node";
  const SHIM = "/home/u/.wave/cli/desktop/bin/wave-code.js";

  it("probes the login shell's PATH and tolerates the first-login banner", async () => {
    // Prime the per-distro shell cache first (every spawn reads h.stdout).
    h.stdout = Buffer.from("/bin/bash\n");
    await expect(withWslLoginShell("Ubuntu", "true")).resolves.toBe(
      "/bin/bash -lic 'true'",
    );
    h.stdout = Buffer.from(
      `${BASHRC_BANNER}\nWAVE_WSL_PATH=/home/liuyiqi02/.local/bin:/usr/bin:/bin\n`,
    );
    await expect(getWslLoginPath("Ubuntu")).resolves.toBe(
      "/home/liuyiqi02/.local/bin:/usr/bin:/bin",
    );
    const probe = h.spawnCalls.at(-1);
    expect(probe?.args.slice(0, 4)).toEqual([
      "-d",
      "Ubuntu",
      "-e",
      "/bin/bash",
    ]);
    expect(probe?.args.at(-1)).toContain("WAVE_WSL_PATH");
    // Node is never probed: the managed runtime's node is exec'd by absolute
    // path, so `command -v node` has no business here.
    expect(probe?.args.at(-1)).not.toContain("command -v node");
  });

  it("caches per distro and does not fail when the shell reports no PATH", async () => {
    h.stdout = Buffer.from("\nWAVE_WSL_PATH=/usr/bin:/bin\n");
    await expect(getWslLoginPath("Ubuntu")).resolves.toBe("/usr/bin:/bin");
    await getWslLoginPath("Ubuntu");
    expect(
      h.spawnCalls.filter((c) => c.args.at(-1)?.includes("WAVE_WSL_PATH")),
    ).toHaveLength(1);
  });

  it("execs the managed runtime, with its bin dir first on PATH", async () => {
    h.stdout = Buffer.from(
      "\nWAVE_WSL_PATH=/home/me/.local/bin:/usr/bin:/bin\n",
    );
    const spec = await buildWslCliSpawnSpec("Ubuntu", SHIM, RUNTIME_NODE);
    // No interactive login shell (its motd would land on stdout, which IS the
    // --stdio channel), and no bare `node`: the managed runtime's absolute path
    // runs the CLI, its bin dir leads the login shell's PATH (so hooks/tools see
    // the same node the CLI runs on), and pnpm & friends still resolve.
    expect(spec.args).toEqual([
      "-d",
      "Ubuntu",
      "-e",
      "sh",
      "-c",
      "PATH='/home/me/.wave/runtime/node/bin:/home/me/.local/bin:/usr/bin:/bin'; " +
        "export PATH; " +
        `exec '${RUNTIME_NODE}' '${SHIM}' --stdio`,
    ]);
    expect(spec.file).toMatch(/wsl\.exe$/);
  });

  it("falls back to the runtime's own bin dir when the shell reports no PATH", async () => {
    h.stdout = Buffer.from("\nWAVE_WSL_PATH=\n");
    const spec = await buildWslCliSpawnSpec(
      "Ubuntu",
      "/home/u/wave-code.js",
      RUNTIME_NODE,
    );
    expect(spec.args.at(-1)).toBe(
      "PATH='/home/me/.wave/runtime/node/bin'; export PATH; " +
        `exec '${RUNTIME_NODE}' '/home/u/wave-code.js' --stdio`,
    );
  });
});
