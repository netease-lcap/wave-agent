import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";

// Mock os.homedir before importing configurationService
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...(actual as typeof os),
    homedir: vi.fn(),
  };
});

import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("ConfigurationService Merging", () => {
  let tempDir: string;
  let userHome: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-config-test-"));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), "wave-user-home-"));

    vi.mocked(os.homedir).mockReturnValue(userHome);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should merge permissions.allow from user and project configs", async () => {
    // 1. Setup user config
    const userWaveDir = path.join(userHome, ".wave");
    await fs.mkdir(userWaveDir, { recursive: true });
    await fs.writeFile(
      path.join(userWaveDir, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Bash(ls)", "Bash(pwd)"],
        },
      }),
    );

    // 2. Setup project config
    const projectWaveDir = path.join(tempDir, ".wave");
    await fs.mkdir(projectWaveDir, { recursive: true });
    await fs.writeFile(
      path.join(projectWaveDir, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Bash(pwd)", "Bash(whoami)"],
        },
      }),
    );

    // 3. Load merged config
    const mergedConfig = loadMergedWaveConfig(tempDir);

    expect(mergedConfig).toBeDefined();
    expect(mergedConfig?.permissions?.allow).toContain("Bash(ls)");
    expect(mergedConfig?.permissions?.allow).toContain("Bash(pwd)");
    expect(mergedConfig?.permissions?.allow).toContain("Bash(whoami)");
    expect(mergedConfig?.permissions?.allow?.length).toBe(3); // pwd should be deduplicated
  });
});
