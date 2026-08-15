import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("wave-agent-sdk", () => ({
  PathEncoder: vi.fn(),
  listSessions: vi.fn(),
  listAllSessions: vi.fn(),
  truncateContent: vi.fn().mockImplementation((s: string) => s),
}));

import { resolveSessionOwnership } from "../src/session-selector-cli.js";
import * as fs from "node:fs";

describe("resolveSessionOwnership", () => {
  let mockEncoder: {
    encode: ReturnType<typeof vi.fn>;
    encodeSync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEncoder = {
      encode: vi.fn().mockImplementation(async (p: string) => p),
      encodeSync: vi.fn().mockImplementation((p: string) => p),
    };
    const { PathEncoder } = await import("wave-agent-sdk");
    vi.mocked(PathEncoder).mockImplementation(function () {
      return mockEncoder as unknown as InstanceType<typeof PathEncoder>;
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("resumes in place when the session belongs to the current directory", async () => {
    mockEncoder.encode.mockImplementation(async (p: string) =>
      p === "/mock/workdir" || p === "/mock/encoded-workdir"
        ? "mock-workdir"
        : p,
    );

    const result = await resolveSessionOwnership(
      { id: "s1", workdir: "/mock/encoded-workdir" },
      { worktreePaths: [], currentWorkdir: "/mock/workdir" },
    );

    expect(result).toEqual({ kind: "current" });
  });

  it("resumes after chdir when the session belongs to a sibling worktree", async () => {
    mockEncoder.encode.mockImplementation(async (p: string) =>
      p === "/mock/repo-wt" || p === "/mock/encoded-repo-wt"
        ? "mock-repo-wt"
        : p,
    );

    const result = await resolveSessionOwnership(
      { id: "s2", workdir: "/mock/encoded-repo-wt" },
      { worktreePaths: ["/mock/repo-wt"], currentWorkdir: "/mock/workdir" },
    );

    expect(result).toEqual({
      kind: "worktree",
      resumeWorkdir: "/mock/repo-wt",
    });
  });

  it("falls through to cross-project when the worktree directory no longer exists", async () => {
    mockEncoder.encode.mockImplementation(async (p: string) =>
      p === "/mock/repo-wt" || p === "/mock/encoded-repo-wt"
        ? "mock-repo-wt"
        : p,
    );
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await resolveSessionOwnership(
      { id: "s3", workdir: "/mock/encoded-repo-wt" },
      { worktreePaths: ["/mock/repo-wt"], currentWorkdir: "/mock/workdir" },
    );

    expect(result.kind).toBe("cross-project");
    if (result.kind === "cross-project") {
      expect(result.command).toContain("cd '/mock/encoded-repo-wt'");
      expect(result.command).toContain("wave --restore s3");
    }
  });

  it("produces a cd command for a session from another project", async () => {
    mockEncoder.encode.mockImplementation(async (p: string) => p);

    const result = await resolveSessionOwnership(
      { id: "s4", workdir: "/other/project" },
      { worktreePaths: ["/mock/repo-wt"], currentWorkdir: "/mock/workdir" },
    );

    expect(result).toEqual({
      kind: "cross-project",
      command: "cd '/other/project' && wave --restore s4",
    });
  });

  it("quotes paths containing spaces in the cd command", async () => {
    mockEncoder.encode.mockImplementation(async (p: string) => p);

    const result = await resolveSessionOwnership(
      { id: "s5", workdir: "/path with/spaces" },
      { worktreePaths: [], currentWorkdir: "/mock/workdir" },
    );

    expect(result.kind).toBe("cross-project");
    if (result.kind === "cross-project") {
      expect(result.command).toBe(
        "cd '/path with/spaces' && wave --restore s5",
      );
    }
  });
});
