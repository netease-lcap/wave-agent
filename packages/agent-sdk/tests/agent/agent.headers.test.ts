import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { ConfigurationService } from "@/services/configurationService.js";

describe("Agent Custom Headers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    vi.resetModules();
    process.env = { ...originalEnv };

    // Provide required gateway config
    process.env.WAVE_API_KEY = "test-api-key";
    process.env.WAVE_BASE_URL = "https://test-gateway.com/api";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should include headers from WAVE_CUSTOM_HEADERS environment variable", async () => {
    process.env.WAVE_CUSTOM_HEADERS = "X-Test-Header: value123";

    const agent = await Agent.create({});
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders).toBeDefined();
    expect(gatewayConfig.defaultHeaders?.["X-Test-Header"]).toBe("value123");
  });

  it("should include multiple headers from WAVE_CUSTOM_HEADERS", async () => {
    process.env.WAVE_CUSTOM_HEADERS = "X-Header-1: val1\nX-Header-2: val2";

    const agent = await Agent.create({});
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders).toEqual({
      "X-Header-1": "val1",
      "X-Header-2": "val2",
    });
  });

  it("should prioritize constructor headers over environment headers", async () => {
    process.env.WAVE_CUSTOM_HEADERS = "X-Test-Header: env-value";

    const agent = await Agent.create({
      defaultHeaders: {
        "X-Test-Header": "constructor-value",
        "X-Another": "another",
      },
    });
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders).toEqual({
      "X-Test-Header": "constructor-value",
      "X-Another": "another",
    });
  });

  it("should merge constructor headers and environment headers (constructor wins on conflict)", async () => {
    process.env.WAVE_CUSTOM_HEADERS =
      "X-Env: env-val\nX-Conflict: env-conflict";

    const agent = await Agent.create({
      defaultHeaders: {
        "X-Constructor": "const-val",
        "X-Conflict": "const-conflict",
      },
    });
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders).toEqual({
      "X-Env": "env-val",
      "X-Constructor": "const-val",
      "X-Conflict": "const-conflict",
    });
  });

  it("should handle headers from settings.json (via this.env)", async () => {
    // Mock loadMergedConfiguration to set env
    vi.spyOn(
      ConfigurationService.prototype,
      "loadMergedConfiguration",
    ).mockImplementation(async function (this: ConfigurationService) {
      this.setEnvironmentVars({
        WAVE_CUSTOM_HEADERS: "X-Settings: settings-val",
      });
      return {
        configuration: {
          env: { WAVE_CUSTOM_HEADERS: "X-Settings: settings-val" },
        },
        success: true,
        sourcePath: "mock",
        warnings: [],
      };
    });

    const agent = await Agent.create({});
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders?.["X-Settings"]).toBe("settings-val");
  });

  it("should prioritize settings.json headers over process.env headers", async () => {
    process.env.WAVE_CUSTOM_HEADERS = "X-Header: process-env-val";

    vi.spyOn(
      ConfigurationService.prototype,
      "loadMergedConfiguration",
    ).mockImplementation(async function (this: ConfigurationService) {
      this.setEnvironmentVars({
        WAVE_CUSTOM_HEADERS: "X-Header: settings-val",
      });
      return {
        configuration: {
          env: { WAVE_CUSTOM_HEADERS: "X-Header: settings-val" },
        },
        success: true,
        sourcePath: "mock",
        warnings: [],
      };
    });

    const agent = await Agent.create({});
    const gatewayConfig = agent.getGatewayConfig();

    expect(gatewayConfig.defaultHeaders?.["X-Header"]).toBe("settings-val");
  });
});
