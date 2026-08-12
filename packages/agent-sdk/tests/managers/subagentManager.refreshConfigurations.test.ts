import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

const baseConfig = (
  name: string,
  extra: Partial<SubagentConfiguration> = {},
): SubagentConfiguration => ({
  name,
  description: name,
  systemPrompt: "p",
  filePath: `/tmp/subagents/${name}.md`,
  scope: "builtin",
  priority: 100,
  ...extra,
});

// Simulates the real conditional registration in subagentParser.ts: builtin
// subagents with `model: visionModel` are only included when the merged env
// carries WAVE_VISION_MODEL.
const mockLoadSubagentConfigurations = vi.fn(
  async (_workdir: string, env: Record<string, string>) => {
    const configs: SubagentConfiguration[] = [baseConfig("bash")];
    if (env.WAVE_VISION_MODEL) {
      configs.push(
        baseConfig("vision", { tools: ["Read"], model: "visionModel" }),
      );
    }
    return configs;
  },
);

vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: (workdir: string, env: Record<string, string>) =>
    mockLoadSubagentConfigurations(workdir, env),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

const mockGetMergedEnv = vi.fn();
vi.mock("../../src/services/configurationService.js", () => ({
  ConfigurationService: vi.fn().mockImplementation(function () {
    return { getMergedEnv: mockGetMergedEnv };
  }),
}));

import { ConfigurationService } from "../../src/services/configurationService.js";

describe("SubagentManager.refreshConfigurations", () => {
  let container: Container;
  let subagentManager: SubagentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();
    container.register(
      "ConfigurationService",
      new ConfigurationService() as unknown as ConfigurationService,
    );
    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
  });

  it("registers vision subagent after settings env becomes available, preserving plugin agents", async () => {
    // Session start: settings.json env not yet loaded → no WAVE_VISION_MODEL
    mockGetMergedEnv.mockReturnValue({});
    await subagentManager.loadConfigurations();
    expect(
      subagentManager.getConfigurations().map((c) => c.name),
    ).not.toContain("vision");

    // Plugin agents registered before config load
    subagentManager.registerPluginAgents("my-plugin", [
      baseConfig("helper", { scope: "plugin" }),
    ]);
    expect(subagentManager.getConfigurations().map((c) => c.name)).toContain(
      "my-plugin:helper",
    );

    // After loadMergedConfiguration, env snapshot carries WAVE_VISION_MODEL
    mockGetMergedEnv.mockReturnValue({ WAVE_VISION_MODEL: "qwen-vl-max" });
    await subagentManager.refreshConfigurations();

    const names = subagentManager.getConfigurations().map((c) => c.name);
    expect(names).toContain("vision");
    // Plugin agent survives the rebuild, exactly once
    expect(names.filter((n) => n === "my-plugin:helper")).toHaveLength(1);
  });

  it("keeps vision filtered out when env still lacks WAVE_VISION_MODEL", async () => {
    mockGetMergedEnv.mockReturnValue({});
    await subagentManager.loadConfigurations();
    await subagentManager.refreshConfigurations();
    expect(
      subagentManager.getConfigurations().map((c) => c.name),
    ).not.toContain("vision");
  });
});
