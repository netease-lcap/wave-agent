import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitService } from "../../src/services/GitService.js";
import { exec } from "child_process";

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

describe("GitService", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService();
  });

  it("should handle repository not found error", async () => {
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: repository 'https://github.com/owner/repo.git/' not found";
    vi.mocked(exec).mockImplementation((_cmd, cb) => {
      if (typeof cb === "function") {
        (
          cb as unknown as (
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
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: Authentication failed for 'https://github.com/owner/repo.git/'";
    vi.mocked(exec).mockImplementation((_cmd, cb) => {
      if (typeof cb === "function") {
        (
          cb as unknown as (
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
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "fatal: not a git repository (or any of the parent directories): .git";
    vi.mocked(exec).mockImplementation((_cmd, cb) => {
      if (typeof cb === "function") {
        (
          cb as unknown as (
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
});
