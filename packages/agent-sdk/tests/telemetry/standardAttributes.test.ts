/**
 * Tests for the standard attribute surface (see
 * docs/specs/enterprise/opentelemetry.md): what every record carries, and how
 * the opt-in repository dimension is derived from a git remote.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const execFileSyncMock = vi.fn();
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  };
});

const mockGetAuthUser = vi.fn();
const mockAnonymousId = vi.fn().mockReturnValue("anon-id");
vi.mock("@/services/authService.js", () => ({
  AuthService: { getInstance: () => ({ getAuthUser: mockGetAuthUser }) },
  getOrCreateAnonymousId: () => mockAnonymousId(),
}));

describe("standard attributes", () => {
  let attributes: typeof import("@/telemetry/attributes.js");
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    execFileSyncMock.mockReset();
    mockGetAuthUser.mockReset();
    mockAnonymousId.mockReturnValue("anon-id");
    delete process.env.TERM_PROGRAM;
    delete process.env.TERM;
    vi.resetModules();
    attributes = await import("@/telemetry/attributes.js");
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("identity", () => {
    it("should use the account id and email when authenticated", () => {
      mockGetAuthUser.mockReturnValue({
        id: "u-1",
        email: "dev@corp.com",
      });

      expect(attributes.getTelemetryAttributes()).toEqual({
        "user.id": "u-1",
        "user.email": "dev@corp.com",
      });
    });

    it("should fall back to the anonymous id when not authenticated", () => {
      mockGetAuthUser.mockReturnValue(undefined);

      // One id per machine, no PII — the same contract the events always had.
      expect(attributes.getTelemetryAttributes()).toEqual({
        "user.id": "anon-id",
      });
    });
  });

  describe("terminal type", () => {
    it("should prefer TERM_PROGRAM over TERM", () => {
      process.env.TERM_PROGRAM = "vscode";
      process.env.TERM = "xterm-256color";

      expect(attributes.getTerminalType()).toBe("vscode");
    });

    it("should be undefined when the environment says nothing", () => {
      expect(attributes.getTerminalType()).toBeUndefined();
    });
  });

  describe("getServiceVersion", () => {
    it("should report the version of the package it shipped in", () => {
      const manifest = JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
      ) as { version: string };

      expect(attributes.getServiceVersion()).toBe(manifest.version);
    });
  });

  describe("repositoryAttributesFromRemote", () => {
    it("should parse a scp-like remote", () => {
      expect(
        attributes.repositoryAttributesFromRemote(
          "git@github.com:netease-lcap/wave-agent.git",
        ),
      ).toEqual({
        "vcs.repository.url.full": "git@github.com:netease-lcap/wave-agent.git",
        "vcs.owner.name": "netease-lcap",
        "vcs.repository.name": "wave-agent",
        "vcs.provider.name": "github",
      });
    });

    it("should keep the whole GitLab namespace as the owner", () => {
      expect(
        attributes.repositoryAttributesFromRemote(
          "https://gitlab.corp.com/group/sub/repo.git",
        ),
      ).toMatchObject({
        "vcs.owner.name": "group/sub",
        "vcs.repository.name": "repo",
        "vcs.provider.name": "gitlab",
      });
    });

    it("should strip credentials out of the exported URL", () => {
      const parsed = attributes.repositoryAttributesFromRemote(
        "https://oauth2:glpat-secret@gitlab.corp.com/group/repo.git",
      );

      expect(parsed).toMatchObject({
        "vcs.repository.url.full": "https://gitlab.corp.com/group/repo.git",
        "vcs.owner.name": "group",
      });
      expect(JSON.stringify(parsed)).not.toContain("glpat-secret");
    });

    it("should report an unknown provider for a self-hosted host", () => {
      expect(
        attributes.repositoryAttributesFromRemote(
          "ssh://git@gitea.corp.com/team/repo.git",
        ),
      ).toMatchObject({ "vcs.provider.name": "unknown" });
    });

    it("should drop the whole group when the remote is unusable", () => {
      expect(attributes.repositoryAttributesFromRemote("")).toBeUndefined();
      expect(
        attributes.repositoryAttributesFromRemote("not a remote"),
      ).toBeUndefined();
      expect(
        attributes.repositoryAttributesFromRemote(
          "git@github.com:only-repo.git",
        ),
      ).toBeUndefined();
    });
  });

  describe("getRepositoryAttributes", () => {
    it("should read the origin remote of the working directory", () => {
      execFileSyncMock.mockReturnValue(
        "git@github.com:netease-lcap/wave-agent.git\n",
      );

      expect(attributes.getRepositoryAttributes("/repo")).toMatchObject({
        "vcs.repository.name": "wave-agent",
      });
      expect(execFileSyncMock).toHaveBeenCalledWith(
        "git",
        ["remote", "get-url", "origin"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("should resolve each working directory once", () => {
      execFileSyncMock.mockReturnValue("git@github.com:o/r.git\n");

      attributes.getRepositoryAttributes("/repo");
      attributes.getRepositoryAttributes("/repo");
      attributes.getRepositoryAttributes("/other");

      expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    });

    it("should return nothing when git fails or there is no origin", () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error("no such remote 'origin'");
      });

      expect(attributes.getRepositoryAttributes("/repo")).toBeUndefined();
      expect(attributes.getRepositoryAttributes(undefined)).toBeUndefined();
    });
  });

  describe("standardAttributes", () => {
    it("should carry identity, terminal type and the session", () => {
      mockGetAuthUser.mockReturnValue(undefined);
      process.env.TERM_PROGRAM = "iTerm.app";

      expect(
        attributes.standardAttributes({
          sessionId: "session-1",
          workdir: "/repo",
        }),
      ).toEqual({
        "user.id": "anon-id",
        "terminal.type": "iTerm.app",
        "session.id": "session-1",
      });
    });

    it("should leave the repository group out unless it is enabled", () => {
      execFileSyncMock.mockReturnValue("git@github.com:o/r.git\n");

      expect(
        attributes.standardAttributes({
          sessionId: "session-1",
          workdir: "/repo",
        }),
      ).not.toHaveProperty("vcs.repository.name");
      expect(execFileSyncMock).not.toHaveBeenCalled();

      expect(
        attributes.standardAttributes({
          sessionId: "session-1",
          workdir: "/repo",
          includeRepository: true,
        }),
      ).toMatchObject({
        "vcs.repository.name": "r",
        "vcs.provider.name": "github",
      });
    });

    it("should carry no session id when the caller does not know one", () => {
      expect(attributes.standardAttributes({})).not.toHaveProperty(
        "session.id",
      );
    });
  });
});
