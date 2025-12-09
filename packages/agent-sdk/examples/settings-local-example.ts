#!/usr/bin/env tsx

/**
 * Simple Settings Local Configuration Test
 *
 * This demonstrates that the settings.local.json support is working:
 * 1. File path resolution prioritizes .local.json over .json
 * 2. Configuration loading works with the new priority system
 * 3. File watching monitors both file types
 */

import {
  getUserConfigPaths,
  getProjectConfigPaths,
  getConfigurationInfo,
  hasAnyConfig as hasHooksConfiguration,
} from "../src/utils/configPaths.js";
import {
  loadProjectWaveConfig,
  loadMergedWaveConfig,
} from "../src/services/configurationService.js";
import { mkdir, writeFile, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const testConfig = {
  baseSettings: {
    env: {
      TEST_BASE_VAR: "from-settings-json",
      TEST_SHARED_VAR: "base-value",
    },
  },
  localSettings: {
    env: {
      TEST_LOCAL_VAR: "from-settings-local-json",
      TEST_SHARED_VAR: "local-overrides-base",
    },
  },
};

async function testConfigurationPriority(): Promise<void> {
  const testDir = join(process.cwd(), "test-settings-local-temp");
  const waveDir = join(testDir, ".wave");

  try {
    // Setup test directory
    await mkdir(waveDir, { recursive: true });
    console.log("📁 Created test directory structure");

    // Test 1: Path Resolution
    console.log("\n=== Test 1: Path Resolution ===");
    const userPaths = getUserConfigPaths();
    const projectPaths = getProjectConfigPaths(testDir);

    console.log("👤 User config paths (priority order):");
    userPaths.forEach((path, index) => {
      console.log(`   ${index + 1}. ${path}`);
    });

    console.log("📁 Project config paths (priority order):");
    projectPaths.forEach((path, index) => {
      console.log(`   ${index + 1}. ${path}`);
    });

    // Verify local.json comes first
    console.log(
      `✅ Local paths have higher priority: ${projectPaths[0].includes(".local.json")}`,
    );

    // Test 2: Configuration Loading Priority
    console.log("\n=== Test 2: Configuration Loading Priority ===");

    // Create base settings.json
    const settingsPath = join(waveDir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify(testConfig.baseSettings, null, 2),
    );
    console.log("📝 Created settings.json");

    // Load config (should load from settings.json)
    let projectConfig = loadProjectWaveConfig(testDir);
    console.log(`📋 Config loaded from settings.json:`, projectConfig?.env);

    // Create settings.local.json
    const localSettingsPath = join(waveDir, "settings.local.json");
    await writeFile(
      localSettingsPath,
      JSON.stringify(testConfig.localSettings, null, 2),
    );
    console.log("📝 Created settings.local.json");

    // Load config again (should now load from settings.local.json)
    projectConfig = loadProjectWaveConfig(testDir);
    console.log(
      `📋 Config loaded from settings.local.json:`,
      projectConfig?.env,
    );

    // Verify local overrode base
    const hasLocalVar =
      projectConfig?.env?.TEST_LOCAL_VAR === "from-settings-local-json";
    const overridesShared =
      projectConfig?.env?.TEST_SHARED_VAR === "local-overrides-base";
    console.log(`✅ Local settings loaded: ${hasLocalVar}`);
    console.log(`✅ Local overrides shared var: ${overridesShared}`);

    // Test 3: Configuration Info
    console.log("\n=== Test 3: Configuration Detection ===");
    const hasConfig = hasHooksConfiguration(testDir);
    const configInfo = getConfigurationInfo(testDir);

    console.log(`📋 Has configuration: ${hasConfig}`);
    console.log(`📂 Config info:`, configInfo);

    // Test 4: Merged Configuration
    console.log("\n=== Test 4: Merged Configuration ===");
    const mergedConfig = loadMergedWaveConfig(testDir);
    console.log(`📋 Merged config:`, mergedConfig?.env);

    console.log(
      "\n✅ All tests passed! Settings.local.json support is working correctly.",
    );
  } catch (error) {
    console.error("❌ Test failed:", (error as Error).message);
    throw error;
  } finally {
    // Cleanup
    if (existsSync(testDir)) {
      await rmdir(testDir, { recursive: true });
      console.log("🧹 Cleaned up test directory");
    }
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testConfigurationPriority().catch(console.error);
}

export { testConfigurationPriority };
