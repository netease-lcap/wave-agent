/**
 * Hook Settings Management
 *
 * Handles loading and merging of hook configurations from:
 * - User settings: ~/.wave/hooks.json
 * - Project settings: ./.wave/hooks.json
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { HookConfiguration, PartialHookConfiguration } from "./types.js";
import { isValidHookEvent } from "./types.js";

/**
 * Get the user-specific hooks configuration file path
 */
export function getUserHooksConfigPath(): string {
  return join(homedir(), ".wave", "hooks.json");
}

/**
 * Get the project-specific hooks configuration file path
 */
export function getProjectHooksConfigPath(): string {
  return join(process.cwd(), ".wave", "hooks.json");
}

/**
 * Load hooks configuration from a JSON file
 */
export function loadHooksConfigFromFile(
  filePath: string,
): PartialHookConfiguration | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = readFileSync(filePath, "utf-8");
    const config = JSON.parse(content) as HookConfiguration;

    // Validate basic structure
    if (!config || typeof config !== "object" || !config.hooks) {
      console.warn(`Invalid hooks configuration structure in ${filePath}`);
      return null;
    }

    return config.hooks;
  } catch (error) {
    console.warn(`Failed to load hooks configuration from ${filePath}:`, error);
    return null;
  }
}

/**
 * Load user hooks configuration
 */
export function loadUserHooksConfig(): PartialHookConfiguration | null {
  return loadHooksConfigFromFile(getUserHooksConfigPath());
}

/**
 * Load project hooks configuration
 */
export function loadProjectHooksConfig(): PartialHookConfiguration | null {
  return loadHooksConfigFromFile(getProjectHooksConfigPath());
}

/**
 * Load and merge hooks configuration with project settings taking precedence
 */
export function loadMergedHooksConfig(): PartialHookConfiguration {
  const userConfig = loadUserHooksConfig();
  const projectConfig = loadProjectHooksConfig();

  const merged: PartialHookConfiguration = {};

  // Start with user configuration
  if (userConfig) {
    Object.entries(userConfig).forEach(([event, configs]) => {
      if (isValidHookEvent(event)) {
        merged[event] = [...configs];
      }
    });
  }

  // Override with project configuration (project takes precedence)
  if (projectConfig) {
    Object.entries(projectConfig).forEach(([event, configs]) => {
      if (isValidHookEvent(event)) {
        merged[event] = [...configs];
      }
    });
  }

  return merged;
}

/**
 * Check if any hooks configuration files exist
 */
export function hasHooksConfiguration(): boolean {
  return (
    existsSync(getUserHooksConfigPath()) ||
    existsSync(getProjectHooksConfigPath())
  );
}

/**
 * Get information about available hooks configuration files
 */
export function getHooksConfigurationInfo(): {
  userConfigExists: boolean;
  projectConfigExists: boolean;
  userConfigPath: string;
  projectConfigPath: string;
} {
  return {
    userConfigExists: existsSync(getUserHooksConfigPath()),
    projectConfigExists: existsSync(getProjectHooksConfigPath()),
    userConfigPath: getUserHooksConfigPath(),
    projectConfigPath: getProjectHooksConfigPath(),
  };
}
