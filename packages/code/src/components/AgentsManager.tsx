import React, { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { SubagentConfiguration } from "wave-agent-sdk";
import { Markdown } from "./Markdown.js";
import {
  agentsManagerReducer,
  type AgentsManagerState,
} from "../reducers/agentsManagerReducer.js";

export interface AgentsManagerProps {
  onCancel: () => void;
  agentDefinitions: SubagentConfiguration[];
}

interface DisplayEntry {
  kind: "header" | "definition" | "empty";
  label: string;
  sub?: string;
  model?: string;
  scope?: SubagentConfiguration["scope"];
  selectableIndex: number; // -1 for non-selectable rows
  definition?: SubagentConfiguration;
}

const SCOPE_LABELS: Record<SubagentConfiguration["scope"], string> = {
  builtin: "Built-in agents",
  user: "User agents",
  project: "Project agents",
  plugin: "Plugin agents",
};

const SCOPE_ORDER: SubagentConfiguration["scope"][] = [
  "builtin",
  "user",
  "project",
  "plugin",
];

const initialState: AgentsManagerState = {
  selectedIndex: 0,
  viewMode: "list",
  pendingEffect: null,
};

export const AgentsManager: React.FC<AgentsManagerProps> = ({
  onCancel,
  agentDefinitions,
}) => {
  const [state, dispatch] = useReducer(agentsManagerReducer, initialState);
  const { stdout } = useStdout();

  // Handle pending effects
  useEffect(() => {
    if (!state.pendingEffect) return;
    const effect = state.pendingEffect;
    dispatch({ type: "CLEAR_PENDING_EFFECT" });
    if (effect.type === "CANCEL") {
      onCancel();
    }
  }, [state.pendingEffect, onCancel]);

  // Flatten definitions (grouped by scope) into one navigable list. Headers
  // and the empty-state line are non-selectable.
  const entries = useMemo<DisplayEntry[]>(() => {
    const result: DisplayEntry[] = [];
    let selectableCount = 0;

    result.push({ kind: "header", label: "AGENTS", selectableIndex: -1 });
    let definitionCount = 0;
    for (const scope of SCOPE_ORDER) {
      const defs = agentDefinitions
        .filter((d) => d.scope === scope)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (defs.length === 0) continue;
      result.push({
        kind: "header",
        label: SCOPE_LABELS[scope],
        scope,
        selectableIndex: -1,
      });
      for (const def of defs) {
        result.push({
          kind: "definition",
          label: def.name,
          model: def.model,
          sub: def.description,
          scope: def.scope,
          selectableIndex: selectableCount++,
          definition: def,
        });
        definitionCount++;
      }
    }
    if (definitionCount === 0) {
      result.push({
        kind: "empty",
        label: "No agents available",
        selectableIndex: -1,
      });
    }

    return result;
  }, [agentDefinitions]);

  const itemCount = entries.filter((e) => e.selectableIndex >= 0).length;

  // Window slice: center the selected item within the visible area, clamping
  // to the terminal's available rows (reusable pattern from
  // BackgroundTaskManager).
  const availableRows = stdout?.rows ?? 24;
  const maxVisible = Math.max(3, Math.min(15, availableRows - 12));
  const selectedFlatIndex = entries.findIndex(
    (e) => e.selectableIndex === state.selectedIndex,
  );
  const startIndex = Math.max(
    0,
    Math.min(
      selectedFlatIndex - Math.floor(maxVisible / 2),
      Math.max(0, entries.length - maxVisible),
    ),
  );
  const visibleEntries = entries.slice(startIndex, startIndex + maxVisible);

  useInput((input, key) => {
    dispatch({ type: "HANDLE_KEY", input, key, itemCount });
  });

  const selectedEntry = entries.find(
    (e) => e.selectableIndex === state.selectedIndex,
  );

  // Detail view — body renders fully expanded with no height limit, no
  // clipping and no scrolling (aligned with Claude Code's AgentDetail).
  if (state.viewMode === "detail" && selectedEntry) {
    const def = selectedEntry.definition;
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
        gap={1}
      >
        <Box>
          <Text color="cyan" bold>
            Agent: {selectedEntry.label}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          {def?.description && (
            <Box>
              <Text>
                <Text color="blue">Description:</Text> {def.description}
              </Text>
            </Box>
          )}
          <Box>
            <Text>
              <Text color="blue">Model:</Text>{" "}
              {def?.model || "default (not explicitly configured)"}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Scope:</Text>{" "}
              {def ? SCOPE_LABELS[def.scope] : ""}
            </Text>
          </Box>
          {def?.tools && def.tools.length > 0 && (
            <Box>
              <Text wrap="wrap">
                <Text color="blue">Tools:</Text> {def.tools.join(", ")}
              </Text>
            </Box>
          )}
          {def?.filePath && (
            <Box>
              <Text wrap="wrap">
                <Text color="blue">File:</Text> {def.filePath}
              </Text>
            </Box>
          )}
        </Box>

        {def && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="blue" bold>
              System Prompt:
            </Text>
            <Box marginLeft={2} marginRight={2}>
              <Markdown>{def.systemPrompt}</Markdown>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>Esc or Enter to go back</Text>
        </Box>
      </Box>
    );
  }

  if (itemCount === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text color="cyan" bold>
          Agents
        </Text>
        <Text>No agents available</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="cyan" bold>
          Agents
        </Text>
      </Box>
      <Text dimColor>Select an agent to view details</Text>

      <Box flexDirection="column">
        {visibleEntries.map((entry, index) => {
          const isSelected = entry.selectableIndex === state.selectedIndex;
          if (entry.kind === "header") {
            return (
              <Text key={`${entry.kind}-${entry.label}-${index}`} dimColor bold>
                {entry.label}
              </Text>
            );
          }
          if (entry.kind === "empty") {
            return (
              <Text key={`empty-${index}`} dimColor>
                {entry.label}
              </Text>
            );
          }
          return (
            <Text
              key={`${entry.kind}-${entry.selectableIndex}`}
              color={isSelected ? "black" : "white"}
              backgroundColor={isSelected ? "cyan" : undefined}
              wrap="truncate-end"
            >
              {isSelected ? "▶ " : "  "}
              {entry.selectableIndex + 1}. {entry.label}
              {entry.model ? (
                <Text color={isSelected ? "black" : "gray"}>
                  {" "}
                  · {entry.model}
                </Text>
              ) : null}
              {entry.sub ? ` · ${entry.sub}` : ""}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to select · Enter to view details · Esc to close
        </Text>
      </Box>
    </Box>
  );
};
