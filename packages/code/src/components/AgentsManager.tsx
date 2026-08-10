import React, { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type {
  BackgroundTask,
  SubagentConfiguration,
  SubagentInstance,
} from "wave-agent-sdk";
import { Markdown } from "./Markdown.js";
import {
  agentsManagerReducer,
  type AgentsManagerState,
} from "../reducers/agentsManagerReducer.js";

export interface AgentsManagerProps {
  onCancel: () => void;
  agentDefinitions: SubagentConfiguration[];
  activeSubagentInstances: SubagentInstance[];
  backgroundTasks: BackgroundTask[];
}

interface ActiveRow {
  id: string;
  name: string;
  description: string;
  status: string;
  model?: string;
}

interface DisplayEntry {
  kind: "header" | "definition" | "active" | "empty";
  label: string;
  sub?: string;
  model?: string;
  status?: string;
  scope?: SubagentConfiguration["scope"];
  selectableIndex: number; // -1 for non-selectable rows
  definition?: SubagentConfiguration;
  active?: ActiveRow;
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

// SubagentInstance uses "active"/"initializing"; background fork tasks use
// "running". Normalize for display so both show as "(running)".
const RUNNING_STATUSES = new Set(["running", "active"]);

const initialState: AgentsManagerState = {
  selectedIndex: 0,
  viewMode: "list",
  pendingEffect: null,
};

export const AgentsManager: React.FC<AgentsManagerProps> = ({
  onCancel,
  agentDefinitions,
  activeSubagentInstances,
  backgroundTasks,
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

  // Background fork subagents run outside SubagentManager (registered as
  // type "subagent" background tasks). Merge them with active instances and
  // dedupe instances that were transitioned to background tasks.
  const activeRows = useMemo<ActiveRow[]>(() => {
    const instanceTaskIds = new Set(
      activeSubagentInstances
        .map((i) => i.backgroundTaskId)
        .filter((id): id is string => Boolean(id)),
    );
    const instanceSubagentIds = new Set(
      activeSubagentInstances.map((i) => i.subagentId),
    );
    const instanceRows: ActiveRow[] = activeSubagentInstances.map(
      (instance) => ({
        id: `instance:${instance.subagentId}`,
        name: instance.configuration.name,
        description: instance.description || instance.configuration.description,
        status: instance.status,
        model: instance.model ?? instance.configuration.model,
      }),
    );
    const forkRows: ActiveRow[] = backgroundTasks
      .filter(
        (task) =>
          task.type === "subagent" &&
          task.status === "running" &&
          !(task.subagentId && instanceSubagentIds.has(task.subagentId)) &&
          !instanceTaskIds.has(task.id),
      )
      .map((task) => ({
        id: `task:${task.id}`,
        name: "fork subagent",
        description: task.description || "",
        status: task.status,
      }));
    return [...instanceRows, ...forkRows];
  }, [activeSubagentInstances, backgroundTasks]);

  // Flatten definitions (grouped by scope) + active subagents into one
  // navigable list. Headers and the empty-state line are non-selectable.
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

    result.push({
      kind: "header",
      label: "ACTIVE SUBAGENTS",
      selectableIndex: -1,
    });
    for (const row of activeRows) {
      result.push({
        kind: "active",
        label: row.name,
        model: row.model,
        sub: row.description,
        status: row.status,
        selectableIndex: selectableCount++,
        active: row,
      });
    }
    if (activeRows.length === 0) {
      result.push({
        kind: "empty",
        label: "No active subagents",
        selectableIndex: -1,
      });
    }

    return result;
  }, [agentDefinitions, activeRows]);

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
            {def ? `Agent: ${selectedEntry.label}` : "Active Subagent Details"}
          </Text>
        </Box>

        {def ? (
          <Box flexDirection="column" gap={1}>
            {def.description && (
              <Box>
                <Text>
                  <Text color="blue">Description:</Text> {def.description}
                </Text>
              </Box>
            )}
            <Box>
              <Text>
                <Text color="blue">Model:</Text>{" "}
                {def.model || "default (not explicitly configured)"}
              </Text>
            </Box>
            <Box>
              <Text>
                <Text color="blue">Scope:</Text> {SCOPE_LABELS[def.scope]}
              </Text>
            </Box>
            {def.tools && def.tools.length > 0 && (
              <Box>
                <Text wrap="wrap">
                  <Text color="blue">Tools:</Text> {def.tools.join(", ")}
                </Text>
              </Box>
            )}
            <Box>
              <Text wrap="wrap">
                <Text color="blue">File:</Text> {def.filePath}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box>
              <Text>
                <Text color="blue">Name:</Text> {selectedEntry.label}
              </Text>
            </Box>
            {selectedEntry.active?.description && (
              <Box>
                <Text wrap="wrap">
                  <Text color="blue">Description:</Text>{" "}
                  {selectedEntry.active.description}
                </Text>
              </Box>
            )}
            <Box>
              <Text>
                <Text color="blue">Status:</Text>{" "}
                <Text
                  color={
                    RUNNING_STATUSES.has(selectedEntry.status ?? "")
                      ? "green"
                      : "yellow"
                  }
                >
                  {RUNNING_STATUSES.has(selectedEntry.status ?? "")
                    ? "running"
                    : selectedEntry.status}
                </Text>
              </Text>
            </Box>
            {selectedEntry.active?.model && (
              <Box>
                <Text>
                  <Text color="blue">Model:</Text> {selectedEntry.active.model}
                </Text>
              </Box>
            )}
          </Box>
        )}

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
              {entry.status && RUNNING_STATUSES.has(entry.status) ? (
                <Text color="green"> (running)</Text>
              ) : entry.status ? (
                <Text color="yellow"> ({entry.status})</Text>
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
