import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GitService } from "../../src/services/GitService.js";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

/** Hand the result to node's callback shape, wherever it landed in the args. */
function settle(
  options: unknown,
  cb: unknown,
  stdout: string,
  stderr: string,
  error: Error | null,
) {
  const callback = (typeof options === "function" ? options : cb) as unknown as
    | ExecFileCallback
    | undefined;
  if (typeof callback === "function") {
    callback(error, stdout, stderr);
  }
}

/**
 * Answer the mocked `execFile` the way node does: three callback arguments,
 * and an error that carries **no** `stdout` / `stderr` — node never puts them
 * there. The wrapper attaches them before rejecting, and `handleGitError`
 * classifies on the attached `stderr`; a fake that pre-attaches it would make
 * every classification test below pass no matter what the wrapper does.
 */
function answerGit(stdout: string, stderr = "", error: Error | null = null) {
  vi.mocked(execFile).mockImplementation((_file, _args, options, cb) => {
    settle(options, cb, stdout, stderr, error);
    return {} as unknown as ReturnType<typeof execFile>;
  });
}

/** Same, but consumed by the next call only (`git --version` in most tests). */
function answerGitOnce(
  stdout: string,
  stderr = "",
  error: Error | null = null,
) {
  vi.mocked(execFile).mockImplementationOnce((_file, _args, options, cb) => {
    settle(options, cb, stdout, stderr, error);
    return {} as unknown as ReturnType<typeof execFile>;
  });
}

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
    answerGit("git version 2.34.1");

    const available = await service.isGitAvailable();
    expect(available).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["--version"],
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("should return false if git is not available", async () => {
    answerGit("", "", new Error("command not found"));

    const available = await service.isGitAvailable();
    expect(available).toBe(false);
  });

  it("should throw clear error if git is missing during clone", async () => {
    answerGit("", "", new Error("command not found"));

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      "Git is not installed or not found in PATH. Please install Git to use Git/GitHub marketplaces.",
    );
  });

  it("should handle repository not found error", async () => {
    // Mock git --version success first
    answerGitOnce("git version 2.34.1");
    answerGit(
      "",
      "fatal: repository 'https://github.com/owner/repo.git/' not found",
      new Error("Command failed"),
    );

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Repository "owner\/repo" not found/,
    );
  });

  it("should handle authentication failure", async () => {
    // Mock git --version success first
    answerGitOnce("git version 2.34.1");
    answerGit(
      "",
      "fatal: Authentication failed for 'https://github.com/owner/repo.git/'",
      new Error("Command failed"),
    );

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Authentication failed for repository "owner\/repo"/,
    );
  });

  it("should handle not a git repository error in pull", async () => {
    // Mock git --version success first
    answerGitOnce("git version 2.34.1");
    answerGit(
      "",
      "fatal: not a git repository (or any of the parent directories): .git",
      new Error("Command failed"),
    );

    await expect(service.pull("/path")).rejects.toThrow(
      /The path "\/path" is not a valid git repository/,
    );
  });

  it("should handle git operation timeout", async () => {
    // Mock git --version success first
    answerGitOnce("git version 2.34.1");
    answerGit(
      "",
      "",
      Object.assign(new Error("Command failed"), { killed: true }),
    );

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      /Git operation timed out after 120s/,
    );
  });

  it("should handle repository not found error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit("", "Repository not found", new Error("Command failed"));

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Repository "owner/repo" not found',
    );
  });

  it("should handle access denied error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit(
      "",
      "Could not read from remote repository",
      new Error("Command failed"),
    );

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Could not access repository "owner/repo"',
    );
  });

  it("should handle authentication failure", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit("", "Authentication failed", new Error("Command failed"));

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Authentication failed for repository "owner/repo"',
    );
  });

  it("should handle rate limit error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit("", "rate limit", new Error("Command failed"));

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      "GitHub rate limit exceeded",
    );
  });

  it("should handle not a git repository error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit("", "not a git repository", new Error("Command failed"));

    await expect(service.pull("/path")).rejects.toThrow(
      'The path "/path" is not a valid git repository',
    );
  });

  it("should handle generic git error", async () => {
    vi.spyOn(service, "isGitAvailable").mockResolvedValue(true);
    answerGit("", "Unknown error", new Error("Unknown error"));

    await expect(service.clone("owner/repo", "/path")).rejects.toThrow(
      'Git operation failed for "owner/repo": Unknown error',
    );
  });
});
