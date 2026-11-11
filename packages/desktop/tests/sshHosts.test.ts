import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn((p: string) => {
    const data = h.files.get(p);
    if (data === undefined) {
      const err = new Error(
        `ENOENT: no such file or directory, open '${p}'`,
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return data;
  }),
  writeFileSync: vi.fn((p: string, data: string) => {
    h.files.set(p, data);
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import {
  LOCAL_HOST,
  SSH_BASE_OPTIONS,
  buildSshSpawnArgs,
  buildSshTunnelArgs,
  findSshConnection,
  getSshConnections,
  isSshConnectionId,
  newSshConnectionId,
  parseSshConfigHosts,
  setSshConnections,
  validateSshConnectionInput,
  type SshConnection,
} from "../src/main/sshHosts";

const CONFIG = "/mock-home/.ssh/config";

beforeEach(() => {
  h.files.clear();
});

describe("parseSshConfigHosts", () => {
  it("returns [] when the config file is missing", () => {
    expect(parseSshConfigHosts(CONFIG)).toEqual([]);
  });

  it("returns [] when the config file is unreadable (corrupt)", () => {
    h.files.set(CONFIG, "not-ssh-config{{{");
    expect(parseSshConfigHosts(CONFIG)).toEqual([]);
  });

  it("lists top-level Host block names", () => {
    h.files.set(
      CONFIG,
      [
        "Host prod",
        "  HostName 10.0.0.1",
        "",
        "Host staging",
        "  User deploy",
      ].join("\n"),
    );
    expect(parseSshConfigHosts(CONFIG)).toEqual(["prod", "staging"]);
  });

  it("skips wildcard patterns, comments, and Include lines", () => {
    h.files.set(
      CONFIG,
      [
        "# comment",
        "Include ~/.ssh/other.conf",
        "Host *",
        "Host *.example.com",
        "Host prod",
        "Host ?",
      ].join("\n"),
    );
    expect(parseSshConfigHosts(CONFIG)).toEqual(["prod"]);
  });

  it("handles multiple names on one Host line and dedupes", () => {
    h.files.set(CONFIG, "Host prod prod2\nHost prod\n");
    expect(parseSshConfigHosts(CONFIG)).toEqual(["prod", "prod2"]);
  });

  it("trims lines, so indentation does not hide a Host block", () => {
    // Lines are trimmed before matching (mirroring ssh config parsing), so a
    // Host line with leading whitespace still registers as a host.
    h.files.set(
      CONFIG,
      "Host prod\n  HostName 10.0.0.1\n  Host nested\nHost other\n",
    );
    expect(parseSshConfigHosts(CONFIG)).toEqual(["prod", "nested", "other"]);
  });
});

describe("connection library registry", () => {
  afterEach(() => {
    // 模块级注册表：每个用例自己装自己那一份，别漏到下一条用例里。
    setSshConnections([]);
  });

  it("installs and reads back entries (defensively copied)", () => {
    const entry = { id: "ssh-1", name: "生产机", host: "prod" };
    setSshConnections([entry]);
    expect(getSshConnections()).toEqual([entry]);
    // 调用方改自己那份不能影响注册表（ssh argv 依赖它的稳定性）。
    getSshConnections()[0].host = "tampered";
    expect(findSshConnection("ssh-1")?.host).toBe("prod");
  });

  it("resolves ids, not hosts: an unknown id is not a connection", () => {
    setSshConnections([{ id: "ssh-1", name: "生产机", host: "prod" }]);
    expect(isSshConnectionId("ssh-1")).toBe(true);
    expect(isSshConnectionId("prod")).toBe(false);
    expect(isSshConnectionId(LOCAL_HOST)).toBe(false);
    expect(findSshConnection("nope")).toBeUndefined();
  });

  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSshConnectionId()));
    expect(ids.size).toBe(50);
  });
});

describe("validateSshConnectionInput", () => {
  const noConnections: SshConnection[] = [];

  it("accepts user@hostname and defaults the name to the host", () => {
    expect(
      validateSshConnectionInput({ host: " dev@box " }, noConnections),
    ).toEqual({
      ok: true,
      value: { id: undefined, name: "dev@box", host: "dev@box" },
    });
  });

  it("accepts a ~/.ssh/config alias, including one with a colon", () => {
    expect(
      validateSshConnectionInput({ host: "prod-alias" }, noConnections).ok,
    ).toBe(true);
    expect(
      validateSshConnectionInput({ host: "corp:prod" }, noConnections).ok,
    ).toBe(true);
  });

  it("keeps the explicit name and trims it", () => {
    const result = validateSshConnectionInput(
      { name: "  生产机  ", host: "prod" },
      noConnections,
    );
    expect(result.ok && result.value.name).toBe("生产机");
  });

  it("parses the port from a string and drops an empty one", () => {
    const withPort = validateSshConnectionInput(
      { host: "prod", port: "2222" },
      noConnections,
    );
    expect(withPort.ok && withPort.value.port).toBe(2222);
    const empty = validateSshConnectionInput(
      { host: "prod", port: "  " },
      noConnections,
    );
    expect(empty.ok && "port" in empty.value).toBe(false);
  });

  it("rejects an empty host", () => {
    expect(validateSshConnectionInput({ host: "   " }, noConnections)).toEqual({
      ok: false,
      error: "请填写主机（user@hostname 或 ~/.ssh/config 里的别名）",
    });
  });

  it("rejects an ssh:// URL and tells the user what to type instead", () => {
    expect(
      validateSshConnectionInput({ host: "ssh://dev@box" }, noConnections),
    ).toEqual({ ok: false, error: "去掉 ssh:// 前缀，只填 user@hostname" });
  });

  it("rejects a port written into the host field", () => {
    expect(
      validateSshConnectionInput({ host: "box:2222" }, noConnections),
    ).toEqual({
      ok: false,
      error: "端口请填到端口栏，主机栏只填主机或别名",
    });
    expect(
      validateSshConnectionInput({ host: "dev@box:2222" }, noConnections).ok,
    ).toBe(false);
  });

  it("allows IPv6-looking hosts (a single trailing :digits is not the only shape)", () => {
    expect(
      validateSshConnectionInput({ host: "fe80::1" }, noConnections).ok,
    ).toBe(true);
    expect(
      validateSshConnectionInput({ host: "[2001:db8::1]:22" }, noConnections)
        .ok,
    ).toBe(true);
  });

  it("rejects whitespace, a leading dash, and characters ssh would misread", () => {
    expect(
      validateSshConnectionInput({ host: "my host" }, noConnections),
    ).toEqual({ ok: false, error: "主机栏不能包含空格" });
    expect(
      validateSshConnectionInput({ host: "-oProxyCommand=x" }, noConnections),
    ).toEqual({ ok: false, error: "主机栏不能以 - 开头" });
    expect(
      validateSshConnectionInput({ host: "box;reboot" }, noConnections),
    ).toEqual({
      ok: false,
      error: "主机名只能包含字母、数字、. - _ : @ 等字符",
    });
  });

  it("rejects a port outside 1–65535", () => {
    for (const port of ["0", "65536", "22.5", "abc"]) {
      expect(
        validateSshConnectionInput({ host: "prod", port }, noConnections),
      ).toEqual({ ok: false, error: "端口必须是 1–65535 的数字" });
    }
  });

  it("rejects a second entry with the same host, but not the entry being edited", () => {
    const existing: SshConnection[] = [
      { id: "ssh-1", name: "生产机", host: "prod" },
    ];
    expect(validateSshConnectionInput({ host: "prod" }, existing)).toEqual({
      ok: false,
      error: "已有使用该主机的连接：生产机",
    });
    expect(
      validateSshConnectionInput({ id: "ssh-1", host: "prod" }, existing).ok,
    ).toBe(true);
  });
});

describe("buildSshSpawnArgs", () => {
  it("prepends the ssh options and keeps the remote command as ONE argv entry", () => {
    expect(buildSshSpawnArgs("prod", "/path/to/wave --stdio")).toEqual([
      ...SSH_BASE_OPTIONS,
      "prod",
      "/path/to/wave --stdio",
    ]);
  });

  it("resolves the saved entry's port and key into the argv", () => {
    setSshConnections([
      {
        id: "ssh-1",
        name: "生产机",
        host: "dev@prod",
        port: 2222,
        identityFile: "~/.ssh/prod_ed25519",
      },
    ]);
    try {
      expect(buildSshSpawnArgs("ssh-1", "/path/to/wave --stdio")).toEqual([
        ...SSH_BASE_OPTIONS,
        "-p",
        "2222",
        "-i",
        "~/.ssh/prod_ed25519",
        "dev@prod",
        "/path/to/wave --stdio",
      ]);
    } finally {
      setSshConnections([]);
    }
  });

  it("passes an alias through untouched so ssh resolves it from the user's config", () => {
    setSshConnections([{ id: "ssh-2", name: "别名", host: "prod-alias" }]);
    try {
      expect(buildSshSpawnArgs("ssh-2", "cmd")).toEqual([
        ...SSH_BASE_OPTIONS,
        "prod-alias",
        "cmd",
      ]);
    } finally {
      setSshConnections([]);
    }
  });
});

describe("buildSshTunnelArgs", () => {
  it("builds an -N unix-socket forward with ExitOnForwardFailure", () => {
    expect(
      buildSshTunnelArgs(
        "prod",
        "/tmp/wave-daemon-prod.sock",
        "/home/u/.wave/daemon.sock",
      ),
    ).toEqual([
      ...SSH_BASE_OPTIONS,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-N",
      "-L",
      "/tmp/wave-daemon-prod.sock:/home/u/.wave/daemon.sock",
      "prod",
    ]);
  });

  it("finds the tunnel target through the same entry resolution", () => {
    setSshConnections([
      { id: "ssh-1", name: "生产机", host: "prod-alias", port: 2200 },
    ]);
    try {
      const args = buildSshTunnelArgs(
        "ssh-1",
        "127.0.0.1:5000",
        "/home/u/d.sock",
      );
      expect(args.slice(-3)).toEqual(["-p", "2200", "prod-alias"]);
      // 转发目标仍在最后：ssh 只把 hostname 之后的东西当远端命令，端口/密钥
      // 必须排在 hostname **之前**（否则会被当成远端命令的一部分）。
      expect(args[args.length - 1]).toBe("prod-alias");
    } finally {
      setSshConnections([]);
    }
  });

  it("keeps ServerAlive probes tight enough to detect a half-open tunnel after sleep", () => {
    const args = buildSshTunnelArgs(
      "prod",
      "/tmp/wave-daemon-prod.sock",
      "/home/u/.wave/daemon.sock",
    );
    const aliveInterval = Number(
      args.find((a) => a.startsWith("ServerAliveInterval="))?.split("=")[1],
    );
    const aliveCountMax = Number(
      args.find((a) => a.startsWith("ServerAliveCountMax="))?.split("=")[1],
    );
    // interval × count bounds the dead-tunnel detection time, so the app never
    // sits in an unbounded "looks alive but silent" state.
    expect(aliveInterval * aliveCountMax).toBeLessThanOrEqual(60);
  });
});

describe("LOCAL_HOST", () => {
  it("is the sentinel for local sessions", () => {
    expect(LOCAL_HOST).toBe("local");
  });
});
