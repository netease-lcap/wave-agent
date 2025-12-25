import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureGlobalGitIgnore } from "../../src/utils/fileUtils.js";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

vi.mock("node:fs/promises");
vi.mock("node:child_process");
vi.mock("node:os");

describe("fileUtils - ensureGlobalGitIgnore", () => {
  const mockHomedir = "/home/user";
  const defaultGlobalIgnorePath = path.join(
    mockHomedir,
    ".config",
    "git",
    "ignore",
  );

  beforeEach(() => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    vi.mocked(homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("should add pattern to global ignore file if not present", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockResolvedValue("existing-pattern\n");
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "existing-pattern\nnew-pattern\n",
      "utf8",
    );
  });

  it("should not add pattern if already present", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockResolvedValue("existing-pattern\nnew-pattern\n");

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should create file if it doesn't exist", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(defaultGlobalIgnorePath));
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "new-pattern\n",
      "utf8",
    );
  });

  it("should use default path if git config fails", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git config failed");
    });
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureGlobalGitIgnore("new-pattern");

    expect(fs.writeFile).toHaveBeenCalledWith(
      defaultGlobalIgnorePath,
      "new-pattern\n",
      "utf8",
    );
  });
});
