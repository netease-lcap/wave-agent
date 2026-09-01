import React, { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  HOOK_EVENT_SUMMARIES,
  type HookEvent,
  type HookEventConfig,
} from "wave-agent-sdk";
import {
  hooksManagerReducer,
  type HooksManagerState,
} from "../reducers/hooksManagerReducer.js";

export interface HooksManagerProps {
  onCancel: () => void;
  /** Hook configs per scope (user/project/plugin settings.json + plugin set). */
  hooks: Partial<
    Record<"user" | "project" | "plugin", Record<string, HookEventConfig[]>>
  >;
}

interface DisplayEntry {
  kind: "header" | "hook" | "empty";
  label: string;
  sub?: string;
  scope?: "user" | "project" | "plugin";
  selectableIndex: number; // -1 for non-selectable rows
  hook?: {
    event: string;
    matcher?: string;
    config: HookEventConfig;
  };
}

const SCOPE_LABELS: Record<"user" | "project" | "plugin", string> = {
  user: "User hooks",
  project: "Project hooks",
  plugin: "Plugin hooks",
};

const SCOPE_ORDER: Array<"user" | "project" | "plugin"> = [
  "user",
  "project",
  "plugin",
];

const initialState: HooksManagerState = {
  selectedIndex: 0,
  viewMode: "list",
  pendingEffect: null,
};

/** Hook name for display: `Event:Matcher` when a matcher is present, else the
 * event name alone. */
function formatHookName(event: string, matcher?: string): string {
  return matcher ? `${event}:${matcher}` : event;
}

export const HooksManager: React.FC<HooksManagerProps> = ({
  onCancel,
  hooks,
}) => {
  const [state, dispatch] = useReducer(hooksManagerReducer, initialState);
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

  // Flatten hooks (grouped by scope) into one navigable list. Headers and
  // the empty-state line are non-selectable.
  const entries = useMemo<DisplayEntry[]>(() => {
    const result: DisplayEntry[] = [];
    let selectableCount = 0;

    result.push({ kind: "header", label: "HOOKS", selectableIndex: -1 });
    let hookCount = 0;
    for (const scope of SCOPE_ORDER) {
      const scoped = hooks[scope] ?? {};
      const rows: DisplayEntry[] = [];
      for (const [event, configs] of Object.entries(scoped)) {
        for (const config of configs ?? []) {
          const matcher = config.matcher;
          const name = formatHookName(event, matcher);
          rows.push({
            kind: "hook",
            label: name,
            sub:
              HOOK_EVENT_SUMMARIES[event as HookEvent] ??
              config.hooks[0]?.command,
            scope,
            selectableIndex: selectableCount++,
            hook: { event, matcher, config },
          });
        }
      }
      if (rows.length === 0) continue;
      result.push({
        kind: "header",
        label: SCOPE_LABELS[scope],
        scope,
        selectableIndex: -1,
      });
      result.push(...rows);
      hookCount += rows.length;
    }
    if (hookCount === 0) {
      result.push({
        kind: "empty",
        label: "No hooks configured",
        selectableIndex: -1,
      });
    }

    return result;
  }, [hooks]);

  const itemCount = entries.filter((e) => e.selectableIndex >= 0).length;

  // Window slice: center the selected item within the visible area, clamping
  // to the terminal's available rows (reusable pattern from
  // AgentsManager/SkillsManager).
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
  // clipping and no scrolling (aligned with AgentsManager/SkillsManager).
  if (state.viewMode === "detail" && selectedEntry?.hook) {
    const { event, matcher, config } = selectedEntry.hook;
    const summary = HOOK_EVENT_SUMMARIES[event as HookEvent];
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
            Hook: {formatHookName(event, matcher)}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box>
            <Text wrap="wrap">
              <Text color="blue">Event:</Text> {event}
              {summary ? ` — ${summary}` : ""}
            </Text>
          </Box>
          {matcher && (
            <Box>
              <Text>
                <Text color="blue">Matcher:</Text> {matcher}
              </Text>
            </Box>
          )}
          <Box flexDirection="column" gap={0}>
            <Text color="blue">Commands:</Text>
            {config.hooks.map((hook, index) => (
              <Text key={index} wrap="wrap">
                {index + 1}. {hook.command}
                {hook.async ? " (async)" : ""}
                {hook.timeout ? ` (timeout ${hook.timeout}s)` : ""}
              </Text>
            ))}
          </Box>
        </Box>

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
          Hooks
        </Text>
        <Text>No hooks configured</Text>
        <Text dimColor>
          Configure hooks in the hooks field of ~/.wave/settings.json or
          .wave/settings.json, or ask Claude to set one up for you
        </Text>
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
          Hooks
        </Text>
      </Box>
      <Text dimColor>Select a hook to view details</Text>

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
