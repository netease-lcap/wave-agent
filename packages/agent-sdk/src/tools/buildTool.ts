import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required?: string[];
  execute: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
  prompt?:
    | string
    | ((args?: {
        availableSubagents?: SubagentConfiguration[];
        availableSkills?: SkillMetadata[];
        workdir?: string;
        isSubagent?: boolean;
      }) => string);
  formatCompactParams?: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => string;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  additionalProperties?: boolean;
}

export function buildTool(def: ToolDef): ToolPlugin {
  const config: ChatCompletionFunctionTool = {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: "object",
        properties: def.parameters,
        required: def.required || [],
        additionalProperties: def.additionalProperties ?? false,
      },
    },
  };

  // Normalize prompt: if string, wrap in function
  let promptFn: ToolPlugin["prompt"];
  if (typeof def.prompt === "string") {
    const staticPrompt = def.prompt;
    promptFn = () => staticPrompt;
  } else {
    promptFn = def.prompt;
  }

  return {
    name: def.name,
    config,
    execute: def.execute,
    prompt: promptFn,
    formatCompactParams: def.formatCompactParams,
    shouldDefer: def.shouldDefer ?? false,
    alwaysLoad: def.alwaysLoad ?? false,
  };
}
