/**
 * Configuration Path Utilities
 *
 * Centralized utilities for resolving Wave configuration file paths.
 * Supports both regular settings.json and settings.local.json with proper priority.
 *
 * Priority system:
 * - User configs: ~/.wave/settings.local.json > ~/.wave/settings.json
 * - Project configs: {workdir}/.wave/settings.local.json > {workdir}/.wave/settings.json
 * - Project configs override user configs (existing behavior)
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

/**
 * Get the user-specific configuration file path (legacy function)
 * @deprecated Use getUserConfigPaths() for better priority support
 */
export function getUserConfigPath(): string {
  return join(homedir(), ".wave", "settings.json");
}

/**
 * Get the project-specific configuration file path (legacy function)
 * @deprecated Use getProjectConfigPaths() for better priority support
 */
export function getProjectConfigPath(workdir: string): string {
  return join(workdir, ".wave", "settings.json");
}

/**
 * Get the user-specific configuration file paths in priority order
 * Returns array with .local.json first, then .json
 */
export function getUserConfigPaths(): string[] {
  const baseDir = join(homedir(), ".wave");
  return [join(baseDir, "settings.local.json"), join(baseDir, "settings.json")];
}

/**
 * Get the plugins directory path
 */
export function getPluginsDir(): string {
  return join(homedir(), ".wave", "plugins");
}

/**
 * Get the project-specific configuration file paths in priority order
 * Returns array with .local.json first, then .json
 */
export function getProjectConfigPaths(workdir: string): string[] {
  const baseDir = join(workdir, ".wave");
  return [join(baseDir, "settings.local.json"), join(baseDir, "settings.json")];
}

/**
 * Get all configuration file paths (user and project) in priority order
 * Useful for comprehensive configuration detection
 */
export function getAllConfigPaths(workdir: string): {
  userPaths: string[];
  projectPaths: string[];
  allPaths: string[];
} {
  const userPaths = getUserConfigPaths();
  const projectPaths = getProjectConfigPaths(workdir);

  return {
    userPaths,
    projectPaths,
    allPaths: [...userPaths, ...projectPaths],
  };
}

/**
 * Get existing configuration file paths
 * Returns only the paths that actually exist on the filesystem
 */
export function getExistingConfigPaths(workdir: string): {
  userPaths: string[];
  projectPaths: string[];
  existingPaths: string[];
} {
  const allPaths = getAllConfigPaths(workdir);

  const existingUserPaths = allPaths.userPaths.filter(existsSync);
  const existingProjectPaths = allPaths.projectPaths.filter(existsSync);
  const allExistingPaths = allPaths.allPaths.filter(existsSync);

  return {
    userPaths: existingUserPaths,
    projectPaths: existingProjectPaths,
    existingPaths: allExistingPaths,
  };
}

/**
 * Get the first existing configuration file path with the specified priority
 * @param paths Array of paths in priority order
 * @returns The first path that exists, or undefined if none exist
 */
export function getFirstExistingPath(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

/**
 * Get effective configuration paths (the ones that would actually be used)
 * Returns the highest priority existing path for each category
 */
export function getEffectiveConfigPaths(workdir: string): {
  userPath?: string;
  projectPath?: string;
  effectivePath?: string; // The path that takes final precedence
} {
  const userPaths = getUserConfigPaths();
  const projectPaths = getProjectConfigPaths(workdir);

  const userPath = getFirstExistingPath(userPaths);
  const projectPath = getFirstExistingPath(projectPaths);

  // Project path takes precedence over user path if both exist
  const effectivePath = projectPath || userPath;

  return {
    userPath,
    projectPath,
    effectivePath,
  };
}

/**
 * Check if any configuration files exist
 */
export function hasAnyConfig(workdir: string): boolean {
  const { existingPaths } = getExistingConfigPaths(workdir);
  return existingPaths.length > 0;
}

/**
 * Get configuration information for debugging and monitoring
 */
export function getConfigurationInfo(workdir: string): {
  hasUser: boolean;
  hasProject: boolean;
  paths: string[];
  userPaths: string[];
  projectPaths: string[];
  existingPaths: string[];
  effectivePaths: {
    userPath?: string;
    projectPath?: string;
    effectivePath?: string;
  };
} {
  const allPaths = getAllConfigPaths(workdir);
  const existingPaths = getExistingConfigPaths(workdir);
  const effectivePaths = getEffectiveConfigPaths(workdir);

  return {
    hasUser: existingPaths.userPaths.length > 0,
    hasProject: existingPaths.projectPaths.length > 0,
    paths: allPaths.allPaths,
    userPaths: allPaths.userPaths,
    projectPaths: allPaths.projectPaths,
    existingPaths: existingPaths.existingPaths,
    effectivePaths,
  };
}
