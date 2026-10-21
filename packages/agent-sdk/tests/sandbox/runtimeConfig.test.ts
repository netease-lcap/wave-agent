import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSandboxRuntimeConfig,
  canonicalizePath,
  getSandboxTempDir,
} from "../../src/sandbox/runtimeConfig.js";

const WORKDIR = path.resolve("/fake/project");

describe("buildSandboxRuntimeConfig", () => {
  it("makes the workdir, the sandbox temp dir and the package caches writable", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
    });

    // 清单里每一条都是规范拼写（见 canonicalizePath）：测试环境的 HOME 被 mock
    // 成 `/tmp`，在 macOS 上它就是 `/private/tmp` 的软链。
    expect(config.filesystem.allowWrite).toContain(canonicalizePath(WORKDIR));
    expect(config.filesystem.allowWrite).toContain(
      canonicalizePath(getSandboxTempDir()),
    );
    expect(config.filesystem.allowWrite).toContain(
      canonicalizePath(path.join(os.homedir(), ".npm")),
    );
    expect(config.filesystem.allowWrite).toContain(
      canonicalizePath(path.join(os.homedir(), ".cache")),
    );
  });

  it("denies writing the settings files so a command cannot widen its own boundary", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
    });

    expect(config.filesystem.denyWrite).toContain(
      canonicalizePath(path.join(WORKDIR, ".wave", "settings.json")),
    );
    expect(config.filesystem.denyWrite).toContain(
      canonicalizePath(path.join(WORKDIR, ".wave", "settings.local.json")),
    );
    expect(config.filesystem.denyWrite).toContain(
      canonicalizePath(path.join(os.homedir(), ".wave", "settings.json")),
    );
  });

  it("denies all network access when no domain is configured", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
    });

    expect(config.network.allowedDomains).toEqual([]);
    expect(config.network.deniedDomains).toEqual([]);
  });

  it("carries the configured domains, paths and unix-socket switches through", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: {
        enabled: true,
        network: {
          allowedDomains: ["api.github.com"],
          deniedDomains: ["example.com"],
          allowUnixSockets: ["/tmp/docker.sock"],
          allowLocalBinding: true,
        },
        filesystem: {
          denyRead: ["~/.ssh"],
          allowRead: ["~/.ssh/allowed"],
        },
      },
    });

    expect(config.network.allowedDomains).toEqual(["api.github.com"]);
    expect(config.network.deniedDomains).toEqual(["example.com"]);
    expect(config.network.allowUnixSockets).toEqual(["/tmp/docker.sock"]);
    expect(config.network.allowLocalBinding).toBe(true);
    expect(config.filesystem.denyRead).toEqual([
      canonicalizePath(path.join(os.homedir(), ".ssh")),
    ]);
    expect(config.filesystem.allowRead).toEqual([
      canonicalizePath(path.join(os.homedir(), ".ssh", "allowed")),
    ]);
  });

  it("resolves relative entries against the workdir and dedupes the allow list", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: {
        enabled: true,
        filesystem: { allowWrite: [".", "tools"] },
      },
    });

    expect(config.filesystem.allowWrite).toContain(WORKDIR);
    expect(config.filesystem.allowWrite).toContain(path.join(WORKDIR, "tools"));
    expect(
      config.filesystem.allowWrite.filter((entry) => entry === WORKDIR),
    ).toHaveLength(1);
  });

  it("adds permission additionalDirectories to the writable set", () => {
    const extra = path.resolve("/fake/extra");
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
      additionalDirectories: [extra],
    });

    expect(config.filesystem.allowWrite).toContain(extra);
  });

  it("passes ignoreViolations and the ripgrep path through", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: {
        enabled: true,
        ignoreViolations: { "git status": ["/tmp/index.lock"] },
      },
      rgPath: "/usr/bin/rg",
    });

    expect(config.ignoreViolations).toEqual({
      "git status": ["/tmp/index.lock"],
    });
    expect(config.ripgrep).toEqual({ command: "/usr/bin/rg" });
  });
});

/**
 * macOS 的 `/var` 是 `/private/var` 的软链，Seatbelt 按真实路径匹配规则，而
 * sandbox-runtime 只把「原样拼写」的 denyWrite 塞进 profile —— 不归一的话，
 * `os.tmpdir()` 下的工作目录里改 `.wave/settings.json` 能成功（改配置即逃逸）。
 * 这里用一个软链目录把「非规范拼写」稳定复现出来，不依赖平台默认的 tmpdir。
 */
describe("path canonicalization", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeSymlinkedWorkdir(): { workdir: string; real: string } {
    const real = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "wave-sandbox-real-")),
    );
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "wave-sandbox-link-")),
    );
    created.push(real, parent);
    const workdir = path.join(parent, "project");
    fs.symlinkSync(real, workdir, "dir");
    return { workdir, real };
  }

  it.skipIf(process.platform === "win32")(
    "resolves the existing part of a path and keeps the missing tail",
    () => {
      const { workdir, real } = makeSymlinkedWorkdir();

      expect(canonicalizePath(workdir)).toBe(real);
      expect(
        canonicalizePath(path.join(workdir, ".wave", "settings.json")),
      ).toBe(path.join(real, ".wave", "settings.json"));
    },
  );

  it("leaves an unresolvable path alone instead of throwing", () => {
    expect(canonicalizePath(WORKDIR)).toBe(WORKDIR);
  });

  it.skipIf(process.platform === "win32")(
    "spells the whole filesystem config canonically when the workdir is a symlink",
    () => {
      const { workdir, real } = makeSymlinkedWorkdir();

      const config = buildSandboxRuntimeConfig({
        workdir,
        sandbox: { enabled: true },
      });

      expect(config.filesystem.allowWrite).toContain(real);
      expect(config.filesystem.allowWrite).not.toContain(workdir);
      expect(config.filesystem.denyWrite).toContain(
        path.join(real, ".wave", "settings.json"),
      );
      expect(config.filesystem.denyWrite).toContain(
        path.join(real, ".wave", "settings.local.json"),
      );
    },
  );
});
