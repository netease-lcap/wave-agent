import type { WorkflowMeta } from "./types.js";
import { logger } from "../utils/globalLogger.js";

/** Patterns that are banned in workflow scripts for safety and determinism */
const BANNED_PATTERNS = [
  {
    pattern: /\brequire\s*\(/,
    message: "require() is not available in workflow scripts",
  },
  {
    pattern: /\bprocess\./,
    message: "process.* is not available in workflow scripts",
  },
  {
    pattern: /\beval\s*\(/,
    message: "eval() is not available in workflow scripts",
  },
  {
    pattern: /\bimport\s+/,
    message: "import statements are not available in workflow scripts",
  },
  {
    pattern: /\bDate\.now\s*\(/,
    message: "Date.now() would break resume determinism",
  },
  {
    pattern: /\bMath\.random\s*\(/,
    message: "Math.random() would break resume determinism",
  },
  {
    pattern: /\bnew\s+Date\s*\(\s*\)/,
    message: "argless new Date() would break resume determinism",
  },
  {
    pattern: /\brequire\s*\(\s*['"]fs['"]\s*\)/,
    message: "filesystem access is not available in workflow scripts",
  },
  {
    pattern: /\bfs\.\w+/,
    message: "filesystem access is not available in workflow scripts",
  },
  {
    pattern: /\bchild_process\b/,
    message: "child_process is not available in workflow scripts",
  },
  {
    pattern: /\b__dirname\b/,
    message: "__dirname is not available in workflow scripts",
  },
  {
    pattern: /\b__filename\b/,
    message: "__filename is not available in workflow scripts",
  },
  {
    pattern: /\bglobal\./,
    message: "global.* is not available in workflow scripts",
  },
  {
    pattern: /\bglobalThis\b/,
    message: "globalThis is not available in workflow scripts",
  },
];

export interface ParsedScript {
  meta: WorkflowMeta;
  body: string;
}

export interface ScriptValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a workflow script for banned patterns and required structure
 */
export function validateScript(script: string): ScriptValidationResult {
  const errors: string[] = [];

  // Check for export const meta = {...}
  if (!/export\s+const\s+meta\s*=/.test(script)) {
    errors.push("Script must start with 'export const meta = {...}'");
  }

  // Check banned patterns
  for (const { pattern, message } of BANNED_PATTERNS) {
    if (pattern.test(script)) {
      errors.push(message);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a workflow script into meta and body.
 * Extracts the `export const meta = {...}` declaration and the rest of the script.
 */
export function parseScript(script: string): ParsedScript {
  // Match: export const meta = { ... }
  // We need to find the matching closing brace for the meta object
  const metaStartMatch = script.match(/export\s+const\s+meta\s*=\s*/);
  if (!metaStartMatch) {
    throw new Error("Script must contain 'export const meta = {...}'");
  }

  const metaStartIndex = metaStartMatch.index! + metaStartMatch[0].length;

  // Find the matching closing brace for the meta object
  let depth = 0;
  let metaEndIndex = -1;
  let inString: string | null = null;
  let escaped = false;

  for (let i = metaStartIndex; i < script.length; i++) {
    const char = script[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        metaEndIndex = i + 1;
        break;
      }
    }
  }

  if (metaEndIndex === -1) {
    throw new Error("Could not find matching closing brace for meta object");
  }

  const metaString = script.slice(metaStartIndex, metaEndIndex);

  // Parse meta as JSON (allowing JS object syntax — unquoted keys, trailing commas)
  // We use a safe approach: wrap in parentheses and use Function to evaluate
  let meta: WorkflowMeta;
  try {
    // Remove trailing comma before closing brace/bracket (common in JS objects)
    const cleaned = metaString.replace(/,\s*([}\]])/g, "$1");
    // Wrap unquoted keys with double quotes
    const quoted = cleaned.replace(/(\w+)\s*:/g, '"$1":');
    meta = JSON.parse(quoted);
  } catch {
    // Fallback: use Function constructor for safe evaluation
    try {
      const fn = new Function(`"use strict"; return (${metaString});`);
      meta = fn();
    } catch (e) {
      throw new Error(
        `Failed to parse meta object: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Validate required meta fields
  if (!meta.name || typeof meta.name !== "string") {
    throw new Error("meta.name is required and must be a string");
  }
  if (!meta.description || typeof meta.description !== "string") {
    throw new Error("meta.description is required and must be a string");
  }

  // Body is everything after the meta declaration (and any trailing semicolons/newlines)
  const bodyStart = metaEndIndex;
  const body = script.slice(bodyStart).replace(/^\s*;?\s*/, "");

  return { meta, body };
}

/**
 * Execute a workflow script with the given API closures.
 * The script body is wrapped in an async IIFE and executed via new Function().
 */
export async function executeScript(
  script: string,
  apis: {
    agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>;
    parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>;
    pipeline: (
      items: unknown[],
      ...stages: Array<
        (prev: unknown, item: unknown, index: number) => Promise<unknown>
      >
    ) => Promise<unknown[]>;
    phase: (title: string) => void;
    log: (message: string) => void;
    args: unknown;
    budget: unknown;
    workflow: (nameOrRef: unknown, args?: unknown) => Promise<unknown>;
  },
  abortSignal?: AbortSignal,
): Promise<{ meta: WorkflowMeta; result: unknown }> {
  // Validate first
  const validation = validateScript(script);
  if (!validation.valid) {
    throw new Error(
      `Script validation failed:\n${validation.errors.join("\n")}`,
    );
  }

  // Parse script
  const { meta, body } = parseScript(script);

  logger.info(
    `[Workflow] Executing script "${meta.name}": ${meta.description}`,
  );

  // Wrap the body in an async function and inject API closures
  const fn = new Function(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    "budget",
    "workflow",
    `"use strict"; return (async () => { ${body} })();`,
  );

  // Execute with abort support
  const scriptPromise = fn(
    apis.agent,
    apis.parallel,
    apis.pipeline,
    apis.phase,
    apis.log,
    apis.args,
    apis.budget,
    apis.workflow,
  );

  let result: unknown;
  if (abortSignal) {
    result = await Promise.race([
      scriptPromise,
      new Promise<never>((_, reject) => {
        if (abortSignal.aborted) {
          reject(new Error("Workflow aborted"));
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => reject(new Error("Workflow aborted")),
          { once: true },
        );
      }),
    ]);
  } else {
    result = await scriptPromise;
  }

  return { meta, result };
}
