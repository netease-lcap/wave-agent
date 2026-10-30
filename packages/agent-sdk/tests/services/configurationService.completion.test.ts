import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync, readFileSync } from "fs";
import {
  ConfigurationService,
  validateConfigurationObject,
} from "../../src/services/configurationService.js";
import type { WaveConfiguration } from "../../src/types/configuration.js";

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

/**
 * Inline completion resolves its model through the same chain as the chat
 * models (docs/specs/ide/code-completion.md story 3): the configured completion
 * model wins, `WAVE_COMPLETION_MODEL` is the escape hatch, and the fast model is
 * the fallback. The agent model is deliberately never used — a slow model would
 * make the ghost text unusable.
 */
describe("ConfigurationService - completion model resolution", () => {
  const workdir = "/test/workdir";
  const userHome = "/test/userhome";
  let configService: ConfigurationService;
  let savedModel: string | undefined;
  let savedFastModel: string | undefined;
  let savedCompletionModel: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(userHome);
    configService = new ConfigurationService();
    mockExistsSync.mockReturnValue(true);

    savedModel = process.env.WAVE_MODEL;
    savedFastModel = process.env.WAVE_FAST_MODEL;
    savedCompletionModel = process.env.WAVE_COMPLETION_MODEL;
    delete process.env.WAVE_MODEL;
    delete process.env.WAVE_FAST_MODEL;
    delete process.env.WAVE_COMPLETION_MODEL;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("WAVE_MODEL", savedModel);
    restore("WAVE_FAST_MODEL", savedFastModel);
    restore("WAVE_COMPLETION_MODEL", savedCompletionModel);
  });

  const load = async (config: Record<string, unknown>) => {
    mockReadFileSync.mockReturnValue(JSON.stringify(config));
    await configService.loadMergedConfiguration(workdir);
  };

  it("uses the configured completion model", async () => {
    await load({
      model: "main-model",
      fastModel: "fast-model",
      completionModel: "completion-model",
    });

    expect(configService.resolveModelConfig().completionModel).toBe(
      "completion-model",
    );
  });

  it("falls back to the fast model when no completion model is configured", async () => {
    // The fast model is configured through env (settings.json `env.WAVE_FAST_MODEL`);
    // a top-level `fastModel` key is not read by resolveModelConfig today.
    await load({ model: "main-model", env: { WAVE_FAST_MODEL: "fast-model" } });

    expect(configService.resolveModelConfig().completionModel).toBe(
      "fast-model",
    );
  });

  it("lets WAVE_COMPLETION_MODEL override the fast-model fallback", async () => {
    await load({ model: "main-model", fastModel: "fast-model" });
    configService.setEnvironmentVars({
      WAVE_COMPLETION_MODEL: "env-completion",
    });

    expect(configService.resolveModelConfig().completionModel).toBe(
      "env-completion",
    );
  });

  it("takes completion params from models[completionModel]", async () => {
    await load({
      completionModel: "completion-model",
      models: { "completion-model": { options: { temperature: 0.05 } } },
    });

    const resolved = configService.resolveModelConfig();
    expect(resolved.completionModel).toBe("completion-model");
    expect(resolved.completionModelOptions).toEqual({ temperature: 0.05 });
  });

  it("leaves completionModelOptions undefined when the model has no params", async () => {
    await load({ completionModel: "completion-model" });

    expect(
      configService.resolveModelConfig().completionModelOptions,
    ).toBeUndefined();
  });

  it("enables completion by default", async () => {
    await load({ model: "main-model" });

    expect(configService.resolveModelConfig().completionEnabled).toBe(true);
  });

  it("honours completionEnabled: false from settings.json", async () => {
    await load({ model: "main-model", completionEnabled: false });

    expect(configService.resolveModelConfig().completionEnabled).toBe(false);
  });

  it("lets AgentOptions.completionEnabled win over settings.json", async () => {
    await load({ model: "main-model", completionEnabled: false });
    configService.setOptions({ completionEnabled: true });

    expect(configService.resolveModelConfig().completionEnabled).toBe(true);
  });

  it("rejects a non-string completionModel and a non-boolean completionEnabled", () => {
    const result = validateConfigurationObject({
      completionModel: 42,
      completionEnabled: "yes",
    } as unknown as WaveConfiguration);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "completionModel configuration must be a string",
        "completionEnabled configuration must be a boolean",
      ]),
    );
  });
});
