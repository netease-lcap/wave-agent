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

import {
  loadMergedWaveConfig,
  ConfigurationService,
} from "../../src/services/configurationService.js";
import * as fs from "fs/promises";
import * as path from "path";
import { DEFAULT_WAVE_MAX_OUTPUT_TOKENS } from "../../src/utils/constants.js";

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

describe("ConfigurationService - maxTokens resolution", () => {
  let configService: ConfigurationService;
  const originalEnv = process.env;

  beforeEach(() => {
    configService = new ConfigurationService();
    process.env = { ...originalEnv };
    delete process.env.WAVE_MAX_OUTPUT_TOKENS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default maxTokens when no other source is provided", () => {
    const resolved = configService.resolveMaxOutputTokens();
    expect(resolved).toBe(DEFAULT_WAVE_MAX_OUTPUT_TOKENS);
    expect(resolved).toBe(4096);
  });

  it("should respect WAVE_MAX_OUTPUT_TOKENS environment variable", () => {
    process.env.WAVE_MAX_OUTPUT_TOKENS = "8192";
    const resolved = configService.resolveMaxOutputTokens();
    expect(resolved).toBe(8192);
  });

  it("should respect WAVE_MAX_OUTPUT_TOKENS from settings.json (internal env)", () => {
    configService.setEnvironmentVars({ WAVE_MAX_OUTPUT_TOKENS: "2048" });
    const resolved = configService.resolveMaxOutputTokens();
    expect(resolved).toBe(2048);
  });

  it("should prioritize settings.json over process.env", () => {
    process.env.WAVE_MAX_OUTPUT_TOKENS = "8192";
    configService.setEnvironmentVars({ WAVE_MAX_OUTPUT_TOKENS: "2048" });
    const resolved = configService.resolveMaxOutputTokens();
    expect(resolved).toBe(2048);
  });

  it("should prioritize constructor options over environment variables", () => {
    process.env.WAVE_MAX_OUTPUT_TOKENS = "8192";
    configService.setEnvironmentVars({ WAVE_MAX_OUTPUT_TOKENS: "2048" });
    const resolved = configService.resolveMaxOutputTokens(1024);
    expect(resolved).toBe(1024);
  });

  it("should resolve model config with maxTokens", () => {
    process.env.WAVE_MAX_OUTPUT_TOKENS = "8192";
    const modelConfig = configService.resolveModelConfig(
      undefined,
      undefined,
      1024,
    );
    expect(modelConfig.maxTokens).toBe(1024);
  });

  it("should resolve model config with maxTokens from environment if not provided in constructor", () => {
    process.env.WAVE_MAX_OUTPUT_TOKENS = "8192";
    const modelConfig = configService.resolveModelConfig();
    expect(modelConfig.maxTokens).toBe(8192);
  });
});
