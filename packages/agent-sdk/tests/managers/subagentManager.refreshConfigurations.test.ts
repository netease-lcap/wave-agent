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
// The builtin vision subagent is also gated on the main model's declarative
// `capabilities.vision` (SubagentManager.getConfigurations). Default = the
// vision-less main model this subagent exists for.
const mockResolveModelConfig = vi.fn(
  (): { model: string; capabilities?: { vision?: boolean } } => ({
    model: "main-model",
    capabilities: { vision: false },
  }),
);
vi.mock("../../src/services/configurationService.js", () => ({
  ConfigurationService: vi.fn().mockImplementation(function () {
    return {
      getMergedEnv: mockGetMergedEnv,
      resolveModelConfig: mockResolveModelConfig,
    };
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

describe("SubagentManager.getConfigurations — builtin vision subagent gate", () => {
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
    // WAVE_VISION_MODEL is set in both cases below — only the main model's
    // vision capability decides whether the subagent is offered.
    mockGetMergedEnv.mockReturnValue({ WAVE_VISION_MODEL: "qwen-vl-max" });
  });

  it("hides the subagent when the main model is not declared vision-less", async () => {
    // Undeclared capabilities = the model sees images directly (opt-out default)
    mockResolveModelConfig.mockReturnValue({ model: "main-model" });
    await subagentManager.loadConfigurations();
    expect(
      subagentManager.getConfigurations().map((c) => c.name),
    ).not.toContain("vision");

    // Explicit `vision: true` is the same answer as undeclared
    mockResolveModelConfig.mockReturnValue({
      model: "main-model",
      capabilities: { vision: true },
    });
    expect(
      subagentManager.getConfigurations().map((c) => c.name),
    ).not.toContain("vision");
  });

  it("follows a model switch without rescanning the filesystem", async () => {
    mockResolveModelConfig.mockReturnValue({
      model: "vision-less-model",
      capabilities: { vision: false },
    });
    await subagentManager.loadConfigurations();
    expect(subagentManager.getConfigurations().map((c) => c.name)).toContain(
      "vision",
    );

    // Same cached scan, different main model: availability follows the model in
    // use, so switching away from the vision-less one drops the subagent.
    mockResolveModelConfig.mockReturnValue({
      model: "vision-model",
      capabilities: { vision: true },
    });
    expect(
      subagentManager.getConfigurations().map((c) => c.name),
    ).not.toContain("vision");
    expect(mockLoadSubagentConfigurations).toHaveBeenCalledTimes(1);
  });

  it("refuses a by-name call to the gated vision subagent", async () => {
    mockResolveModelConfig.mockReturnValue({
      model: "vision-model",
      capabilities: { vision: true },
    });
    await subagentManager.loadConfigurations();
    expect(await subagentManager.findSubagent("vision")).toBeNull();

    // …and resolves it again once the main model is the vision-less one
    mockResolveModelConfig.mockReturnValue({
      model: "vision-less-model",
      capabilities: { vision: false },
    });
    const found = await subagentManager.findSubagent("vision");
    expect(found?.name).toBe("vision");
    expect(found?.model).toBe("visionModel");
  });

  it("keeps a user-written subagent naming a vision model", async () => {
    mockResolveModelConfig.mockReturnValue({
      model: "vision-model",
      capabilities: { vision: true },
    });
    mockGetMergedEnv.mockReturnValue({ WAVE_VISION_MODEL: "qwen-vl-max" });
    mockLoadSubagentConfigurations.mockImplementationOnce(async () => [
      baseConfig("my-vision-helper", {
        scope: "user",
        model: "visionModel",
      }),
    ]);
    await subagentManager.loadConfigurations();
    expect(subagentManager.getConfigurations().map((c) => c.name)).toContain(
      "my-vision-helper",
    );
  });
});
