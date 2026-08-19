import React, { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { SkillMetadata } from "wave-agent-sdk";
import {
  skillsManagerReducer,
  type SkillsManagerState,
} from "../reducers/skillsManagerReducer.js";

export interface SkillsManagerProps {
  onCancel: () => void;
  skills: SkillMetadata[];
}

interface DisplayEntry {
  kind: "header" | "skill" | "empty";
  label: string;
  sub?: string;
  scope?: SkillScope;
  selectableIndex: number; // -1 for non-selectable rows
  skill?: SkillMetadata;
}

type SkillScope = "builtin" | "user" | "project" | "plugin";

const SCOPE_LABELS: Record<SkillScope, string> = {
  builtin: "Built-in skills",
  user: "User skills",
  project: "Project skills",
  plugin: "Plugin skills",
};

const SCOPE_ORDER: SkillScope[] = ["builtin", "user", "project", "plugin"];

const initialState: SkillsManagerState = {
  selectedIndex: 0,
  viewMode: "list",
  pendingEffect: null,
};

/** Group scope for a skill: plugin skills (pluginName set) get their own
 * group, everything else groups by its discovery type ("personal" skills
 * are shown under the user scope). */
function getSkillScope(skill: SkillMetadata): SkillScope {
  if (skill.pluginName) {
    return "plugin";
  }
  if (skill.type === "personal") {
    return "user";
  }
  return skill.type;
}

export const SkillsManager: React.FC<SkillsManagerProps> = ({
  onCancel,
  skills,
}) => {
  const [state, dispatch] = useReducer(skillsManagerReducer, initialState);
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

  // Flatten skills (grouped by scope) into one navigable list. Headers and
  // the empty-state line are non-selectable.
  const entries = useMemo<DisplayEntry[]>(() => {
    const result: DisplayEntry[] = [];
    let selectableCount = 0;

    result.push({ kind: "header", label: "SKILLS", selectableIndex: -1 });
    let skillCount = 0;
    for (const scope of SCOPE_ORDER) {
      const scopedSkills = skills
        .filter((s) => getSkillScope(s) === scope)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (scopedSkills.length === 0) continue;
      result.push({
        kind: "header",
        label: SCOPE_LABELS[scope],
        scope,
        selectableIndex: -1,
      });
      for (const skill of scopedSkills) {
        result.push({
          kind: "skill",
          label: skill.name,
          sub: skill.description,
          scope,
          selectableIndex: selectableCount++,
          skill,
        });
        skillCount++;
      }
    }
    if (skillCount === 0) {
      result.push({
        kind: "empty",
        label: "No skills available",
        selectableIndex: -1,
      });
    }

    return result;
  }, [skills]);

  const itemCount = entries.filter((e) => e.selectableIndex >= 0).length;

  // Window slice: center the selected item within the visible area, clamping
  // to the terminal's available rows (reusable pattern from
  // AgentsManager/BackgroundTaskManager).
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
  // clipping and no scrolling (aligned with AgentsManager's detail view).
  if (state.viewMode === "detail" && selectedEntry) {
    const skill = selectedEntry.skill;
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
            Skill: {selectedEntry.label}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          {skill?.description && (
            <Box>
              <Text>
                <Text color="blue">Description:</Text> {skill.description}
              </Text>
            </Box>
          )}
          <Box>
            <Text>
              <Text color="blue">Scope:</Text>{" "}
              {skill ? SCOPE_LABELS[getSkillScope(skill)] : ""}
              {skill?.pluginName ? ` (${skill.pluginName})` : ""}
            </Text>
          </Box>
          {skill?.skillPath && (
            <Box>
              <Text wrap="wrap">
                <Text color="blue">Path:</Text> {skill.skillPath}
              </Text>
            </Box>
          )}
          {skill?.model && (
            <Box>
              <Text>
                <Text color="blue">Model:</Text> {skill.model}
              </Text>
            </Box>
          )}
          {skill?.agent && (
            <Box>
              <Text>
                <Text color="blue">Agent:</Text> {skill.agent}
              </Text>
            </Box>
          )}
          {skill?.allowedTools && skill.allowedTools.length > 0 && (
            <Box>
              <Text wrap="wrap">
                <Text color="blue">Allowed tools:</Text>{" "}
                {skill.allowedTools.join(", ")}
              </Text>
            </Box>
          )}
          {skill && (
            <Box>
              <Text wrap="wrap">
                <Text color="blue">Invocation:</Text>{" "}
                {[
                  skill.userInvocable === false ? "not user-invocable" : null,
                  skill.disableModelInvocation
                    ? "model invocation disabled"
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "user-invocable, model-invocable"}
              </Text>
            </Box>
          )}
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
          Skills
        </Text>
        <Text>No skills available</Text>
        <Text dimColor>Create skills in .wave/skills/ or ~/.wave/skills/</Text>
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
          Skills
        </Text>
      </Box>
      <Text dimColor>Select a skill to view details</Text>

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
              {entry.scope === "plugin" && entry.skill?.pluginName ? (
                <Text color={isSelected ? "black" : "gray"}>
                  {" "}
                  · {entry.skill.pluginName}
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
