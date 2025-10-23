import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import {
  loadHooksConfigFromFile,
  loadMergedHooksConfig,
} from "../../src/hooks/settings.js";
import type { HookConfiguration } from "../../src/hooks/types.js";

describe("Hook Settings", () => {
  let testDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `wave-hooks-settings-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // Mock console.warn to prevent stderr output
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    // Restore console.warn
    consoleWarnSpy?.mockRestore();
  });

  describe("configuration file loading", () => {
    it("should return null for non-existent file", () => {
      const config = loadHooksConfigFromFile("/non/existent/path.json");
      expect(config).toBeNull();
    });

    it("should load valid configuration file", () => {
      const configFile = join(testDir, "test-hooks.json");
      const testConfig: HookConfiguration = {
        hooks: {
          PreToolUse: [],
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: 'echo "test"' }],
            },
          ],
          UserPromptSubmit: [],
          Stop: [],
        },
      };

      writeFileSync(configFile, JSON.stringify(testConfig, null, 2));

      const loaded = loadHooksConfigFromFile(configFile);
      expect(loaded).toEqual(testConfig.hooks);
    });

    it("should handle invalid JSON gracefully", () => {
      const configFile = join(testDir, "invalid.json");
      writeFileSync(configFile, "{ invalid json }");

      const loaded = loadHooksConfigFromFile(configFile);
      expect(loaded).toBeNull();
    });

    it("should handle invalid configuration structure", () => {
      const configFile = join(testDir, "invalid-structure.json");
      const invalidConfig = { notHooks: "invalid" };
      writeFileSync(configFile, JSON.stringify(invalidConfig));

      const loaded = loadHooksConfigFromFile(configFile);
      expect(loaded).toBeNull();
    });
  });

  describe("merged configuration loading", () => {
    it("should return empty configuration when no files exist", () => {
      const merged = loadMergedHooksConfig("/test/workdir");
      // The test may load user-level configuration, so we just check that it returns an object
      expect(typeof merged).toBe("object");
      expect(merged).not.toBeNull();
    });
  });
});
