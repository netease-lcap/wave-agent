import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginWorkflow } from "../types/plugins.js";
import type { WorkflowMeta } from "./types.js";
import { parseScript } from "./scriptRuntime.js";
import { logger } from "../utils/globalLogger.js";

/** Where a named workflow script came from. */
export type WorkflowSource = "plugin" | "project" | "user";

/** Scope of the on-disk script library. */
export type WorkflowLibraryScope = "project" | "user";

/** Directory name used by both library scopes (`<…>/.wave/workflows`). */
export const WORKFLOW_LIBRARY_DIR_NAME = "workflows";

/** File extension accepted for library and plugin scripts (same as Claude Code). */
export const WORKFLOW_SCRIPT_EXTENSION = ".js";

/** A script reachable by name — either from a plugin or from the on-disk library. */
export interface NamedWorkflow {
  /** Invocation name: `<plugin>:<name>` for plugins, the bare name for the library. */
  name: string;
  description: string;
  source: WorkflowSource;
  /** Absolute path of the script file. */
  path: string;
  meta?: WorkflowMeta;
  /** Owning plugin, present only when `source` is `"plugin"`. */
  pluginName?: string;
}

/**
 * Canonicalize a user-supplied workflow name into a file stem, verbatim from
 * Claude Code: lowercase, runs of non-alphanumerics collapse to `-`, trim, and
 * fall back to `workflow` when nothing survives.
 */
export function sanitizeWorkflowName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workflow"
  );
}

/**
 * Split an invocation name into its namespace and bare name. A name without `:`
 * resolves against the on-disk library; one with `:` resolves against plugins
 * (`<pluginName>:<name>`, the same convention skills/agents/commands use).
 */
export function parseWorkflowName(name: string): {
  pluginName?: string;
  bareName: string;
} {
  const separator = name.indexOf(":");
  if (separator === -1) {
    return { bareName: name };
  }
  return {
    pluginName: name.slice(0, separator),
    bareName: name.slice(separator + 1),
  };
}

/**
 * The single "name → script" resolution step shared by the three script entry
 * points. Plugins are the first source; the on-disk library (`project` then
 * `user`) is resolved lazily by checking the filesystem, so a script saved in
 * this session is usable immediately without any directory scan or watcher.
 *
 * Runs are not scoped by this registry — only script *sources* are, so
 * `resumeFromRunId` stays same-session only.
 */
export class WorkflowRegistry {
  private pluginWorkflows = new Map<string, NamedWorkflow>();

  constructor(private readonly workdir: string) {}

  /**
   * Register a plugin's workflows under `<pluginName>:<name>`. The file stem is
   * the invocation name; `meta.name` is display-only.
   */
  registerPluginWorkflows(
    pluginName: string,
    workflows: PluginWorkflow[],
  ): void {
    for (const workflow of workflows) {
      const name = `${pluginName}:${workflow.name}`;
      this.pluginWorkflows.set(name, {
        name,
        description: workflow.description,
        source: "plugin",
        path: workflow.path,
        meta: workflow.meta,
        pluginName,
      });
    }
  }

  /** Drop every workflow contributed by a plugin. */
  unregisterPluginWorkflows(pluginName: string): void {
    const prefix = `${pluginName}:`;
    for (const key of [...this.pluginWorkflows.keys()]) {
      if (key.startsWith(prefix)) {
        this.pluginWorkflows.delete(key);
      }
    }
  }

  /** Absolute directory of one library scope. */
  libraryDir(scope: WorkflowLibraryScope): string {
    return scope === "project"
      ? join(this.workdir, ".wave", WORKFLOW_LIBRARY_DIR_NAME)
      : join(homedir(), ".wave", WORKFLOW_LIBRARY_DIR_NAME);
  }

  /** Absolute file path a script saved under `name` + `scope` would occupy. */
  libraryPath(name: string, scope: WorkflowLibraryScope): string {
    return join(
      this.libraryDir(scope),
      `${sanitizeWorkflowName(name)}${WORKFLOW_SCRIPT_EXTENSION}`,
    );
  }

  /**
   * Resolve an invocation name to its script. `<plugin>:<name>` → plugin
   * registry; a bare name → `project` library, then `user` library.
   */
  resolve(name: string): NamedWorkflow | undefined {
    const { pluginName, bareName } = parseWorkflowName(name);
    if (pluginName !== undefined) {
      return this.pluginWorkflows.get(`${pluginName}:${bareName}`);
    }

    const scriptName = sanitizeWorkflowName(bareName);
    for (const scope of ["project", "user"] as const) {
      const path = this.libraryPath(scriptName, scope);
      if (!existsSync(path)) {
        continue;
      }
      const parsed = readLibraryScript(path);
      if (!parsed) {
        continue;
      }
      return {
        name: scriptName,
        description: parsed.meta.description,
        source: scope,
        path,
        meta: parsed.meta,
      };
    }
    return undefined;
  }

  /** Every resolvable name: plugin entries plus both library scopes. */
  list(): NamedWorkflow[] {
    const entries = new Map<string, NamedWorkflow>(this.pluginWorkflows);

    for (const scope of ["project", "user"] as const) {
      for (const file of listLibraryFiles(this.libraryDir(scope))) {
        const name = file.slice(0, -WORKFLOW_SCRIPT_EXTENSION.length);
        // Project wins over user for the same bare name.
        if (entries.has(name)) {
          continue;
        }
        const parsed = readLibraryScript(join(this.libraryDir(scope), file));
        if (!parsed) {
          continue;
        }
        entries.set(name, {
          name,
          description: parsed.meta.description,
          source: scope,
          path: join(this.libraryDir(scope), file),
          meta: parsed.meta,
        });
      }
    }

    return [...entries.values()];
  }

  /** Sorted names of everything resolvable, for "did you mean" error text. */
  availableNames(): string[] {
    return this.list()
      .map((entry) => entry.name)
      .sort();
  }
}

/** Read and parse one library script; an unusable file is skipped, not thrown. */
function readLibraryScript(
  scriptPath: string,
): { meta: WorkflowMeta } | undefined {
  try {
    const script = readFileSync(scriptPath, "utf-8");
    return { meta: parseScript(script).meta };
  } catch (error) {
    logger?.warn(
      `Skipping workflow script ${scriptPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/** `*.js` files directly inside a library directory. */
function listLibraryFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(WORKFLOW_SCRIPT_EXTENSION),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    // A missing library directory is the normal state, not an error.
    return [];
  }
}
