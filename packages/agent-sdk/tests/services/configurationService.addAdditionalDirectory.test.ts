import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import { existsSync, promises as fs } from "fs";
import * as path from "path";
import { ConfigurationService } from "../../src/services/configurationService.js";

vi.mock("fs", async () => {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("ConfigurationService - addAdditionalDirectory", () => {
  let configService: ConfigurationService;
  const workdir = "/test/workdir";
  const userHome = "/test/userhome";
  const localConfigPath = path.join(workdir, ".wave", "settings.local.json");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(userHome);
    configService = new ConfigurationService();
    // Default: only workdir/userHome exist, no local config yet
    vi.mocked(existsSync).mockImplementation(
      (p) => p === workdir || p === userHome || p === "/test",
    );
  });

  it("should create settings.local.json with the additional directory when it does not exist", async () => {
    await configService.addAdditionalDirectory(workdir, "/shared/code");

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(workdir, ".wave"), {
      recursive: true,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("settings.local.json.tmp."),
      expect.stringContaining('"/shared/code"'),
      "utf-8",
    );
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.permissions.additionalDirectories).toEqual(["/shared/code"]);
  });

  it("should append to existing additionalDirectories without duplicates", async () => {
    vi.mocked(existsSync).mockImplementation(
      (p) =>
        p === workdir ||
        p === userHome ||
        p === "/test" ||
        p === localConfigPath,
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        permissions: {
          additionalDirectories: ["/existing/dir"],
        },
      }),
    );

    await configService.addAdditionalDirectory(workdir, "/shared/code");
    await configService.addAdditionalDirectory(workdir, "/existing/dir");

    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.permissions.additionalDirectories).toEqual([
      "/existing/dir",
      "/shared/code",
    ]);

    // Second call with duplicate: no write (deduped before write)
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });
});
