import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  buildSandboxRuntimeConfig,
  getSandboxTempDir,
} from "../../src/sandbox/runtimeConfig.js";

const WORKDIR = path.resolve("/fake/project");

describe("buildSandboxRuntimeConfig", () => {
  it("makes the workdir, the sandbox temp dir and the package caches writable", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
    });

    expect(config.filesystem.allowWrite).toContain(WORKDIR);
    expect(config.filesystem.allowWrite).toContain(getSandboxTempDir());
    expect(config.filesystem.allowWrite).toContain(
      path.join(os.homedir(), ".npm"),
    );
    expect(config.filesystem.allowWrite).toContain(
      path.join(os.homedir(), ".cache"),
    );
  });

  it("denies writing the settings files so a command cannot widen its own boundary", () => {
    const config = buildSandboxRuntimeConfig({
      workdir: WORKDIR,
      sandbox: { enabled: true },
    });

    expect(config.filesystem.denyWrite).toContain(
      path.join(WORKDIR, ".wave", "settings.json"),
    );
    expect(config.filesystem.denyWrite).toContain(
      path.join(WORKDIR, ".wave", "settings.local.json"),
    );
    expect(config.filesystem.denyWrite).toContain(
      path.join(os.homedir(), ".wave", "settings.json"),
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
      path.join(os.homedir(), ".ssh"),
    ]);
    expect(config.filesystem.allowRead).toEqual([
      path.join(os.homedir(), ".ssh", "allowed"),
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
