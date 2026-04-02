import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GitService } from "../../src/services/GitService.js";
import { exec } from "child_process";

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

describe("GitService", () => {
  let service: GitService;
  const originalAllowRealGit = process.env.ALLOW_REAL_GIT;

  beforeEach(() => {
    process.env.ALLOW_REAL_GIT = "true";
    vi.clearAllMocks();
    service = new GitService();
  });

  afterEach(() => {
    process.env.ALLOW_REAL_GIT = originalAllowRealGit;
  });

  it("should return true if git is available", async () => {
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: null,
            res: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "git version 2.34.1", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const available = await service.isGitAvailable();
    expect(available).toBe(true);
    expect(exec).toHaveBeenCalledWith("git --version", expect.any(Function));
  });

  it("should return false if git is not available", async () => {
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(new Error("command not found"), { stdout: "", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const available = await service.isGitAvailable();
    expect(available).toBe(false);
  });

  it("should throw clear error if git is missing during clone", async () => {
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(new Error("command not found"), { stdout: "", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      "Git is not installed or not found in PATH. Please install Git to use Git/GitHub marketplaces.",
    );
  });

  it("should handle repository not found error", async () => {
    // Mock git --version success first
    vi.mocked(exec).mockImplementationOnce((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: null,
            res: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "git version 2.34.1", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: repository 'https://github.com/owner/repo.git/' not found";
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(error, {
          stdout: "",
          stderr: (error as unknown as { stderr: string }).stderr,
        });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Repository "owner\/repo" not found/,
    );
  });

  it("should handle authentication failure", async () => {
    // Mock git --version success first
    vi.mocked(exec).mockImplementationOnce((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: null,
            res: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "git version 2.34.1", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: Authentication failed for 'https://github.com/owner/repo.git/'";
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(error, {
          stdout: "",
          stderr: (error as unknown as { stderr: string }).stderr,
        });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Authentication failed for repository "owner\/repo"/,
    );
  });

  it("should handle not a git repository error in pull", async () => {
    // Mock git --version success first
    vi.mocked(exec).mockImplementationOnce((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: null,
            res: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "git version 2.34.1", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: not a git repository (or any of the parent directories): .git";
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(error, {
          stdout: "",
          stderr: (error as unknown as { stderr: string }).stderr,
        });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.pull("/path")).rejects.toThrow(
      /The path "\/path" is not a valid git repository/,
    );
  });

  it("should handle git operation timeout", async () => {
    // Mock git --version success first
    vi.mocked(exec).mockImplementationOnce((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: null,
            res: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "git version 2.34.1", stderr: "" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    const error = new Error("Command failed");
    (error as unknown as { killed: boolean }).killed = true;
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: Error,
            res: { stdout: string; stderr: string },
          ) => void
        )(error, {
          stdout: "",
          stderr: "",
        });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Git operation timed out after 120s/,
    );
  });

  it("should handle repository not found error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )(
          { stderr: "Repository not found" },
          { stdout: "", stderr: "Repository not found" },
        );
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Repository "owner/repo" not found',
    );
  });

  it("should handle access denied error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )(
          { stderr: "Could not read from remote repository" },
          { stdout: "", stderr: "Could not read from remote repository" },
        );
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Could not access repository "owner/repo"',
    );
  });

  it("should handle authentication failure", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )(
          { stderr: "Authentication failed" },
          { stdout: "", stderr: "Authentication failed" },
        );
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Authentication failed for repository "owner/repo"',
    );
  });

  it("should handle rate limit error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )({ stderr: "rate limit" }, { stdout: "", stderr: "rate limit" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      "GitHub rate limit exceeded",
    );
  });

  it("should handle not a git repository error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )(
          { stderr: "not a git repository" },
          { stdout: "", stderr: "not a git repository" },
        );
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.pull("/path")).rejects.toThrow(
      'The path "/path" is not a valid git repository',
    );
  });

  it("should handle generic git error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    vi.mocked(exec).mockImplementation((cmd, options, cb) => {
      const callback = typeof options === "function" ? options : cb;
      if (typeof callback === "function") {
        (
          callback as unknown as (
            err: unknown,
            res: { stdout: string; stderr: string },
          ) => void
        )(new Error("Unknown error"), { stdout: "", stderr: "Unknown error" });
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Git operation failed for "owner/repo": Unknown error',
    );
  });
});
