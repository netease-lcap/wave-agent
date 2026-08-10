/**
 * Agent subagent accessor tests.
 *
 * Covers the read-only accessors added for the CLI /agents overlay:
 * getSubagentConfigurations() and getActiveSubagentInstances().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "../../src/agent.js";
import { loadMergedWaveConfig } from "../../src/services/configurationService.js";
import {
  getUserConfigPaths,
  getProjectConfigPaths,
} from "../../src/utils/configPaths.js";

// Mock configPaths to return empty arrays so we don't load actual settings.json
vi.mock("../../src/utils/configPaths.js", async () => {
  const actual = await vi.importActual("../../src/utils/configPaths.js");
  return {
    ...actual,
    getUserConfigPaths: vi.fn(),
    getProjectConfigPaths: vi.fn(),
  };
});

// Mock loadMergedWaveConfig
vi.mock("../../src/services/configurationService.js", async () => {
  const actual = await vi.importActual(
    "../../src/services/configurationService.js",
  );
  return {
    ...actual,
    loadMergedWaveConfig: vi.fn(),
  };
});

describe("Agent subagent accessors", () => {
  let agent: Agent;
  const mockWorkdir = "/mock/workdir";

  beforeEach(async () => {
    // Clear environment variables that might interfere
    delete process.env.WAVE_API_KEY;
    delete process.env.WAVE_BASE_URL;
    delete process.env.WAVE_MODEL;
    delete process.env.WAVE_FAST_MODEL;
    delete process.env.WAVE_MAX_INPUT_TOKENS;
    // Reset and setup loadMergedWaveConfig mock
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
    // Mock config paths to return empty arrays
    vi.mocked(getUserConfigPaths).mockReturnValue([]);
    vi.mocked(getProjectConfigPaths).mockReturnValue([]);

    process.env.WAVE_API_KEY = "test-token";
    process.env.WAVE_BASE_URL = "https://test.url";
    process.env.WAVE_MODEL = "test-model";

    agent = await Agent.create({
      workdir: mockWorkdir,
    });
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    vi.clearAllMocks();
  });

  it("should return loaded subagent configurations", () => {
    const configs = agent.getSubagentConfigurations();

    // Built-in agents are always present in a fresh session
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      systemPrompt: expect.any(String),
    });
  });

  it("should return no active subagent instances in a fresh session", () => {
    const instances = agent.getActiveSubagentInstances();

    expect(Array.isArray(instances)).toBe(true);
    expect(instances).toHaveLength(0);
  });
});
