import React, { useReducer } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { marketplaceAddFormReducer } from "../reducers/marketplaceAddFormReducer.js";

const SCOPES = [
  { value: "user" as const, label: "user" },
  { value: "project" as const, label: "project" },
  { value: "local" as const, label: "local" },
];

export const MarketplaceAddForm: React.FC = () => {
  const { state, actions } = usePluginManagerContext();
  const [{ source, scopeIndex, step }, dispatch] = useReducer(
    marketplaceAddFormReducer,
    { source: "", scopeIndex: 0, step: "source" },
  );

  useInput((input, key) => {
    if (key.escape) {
      if (step === "scope") {
        dispatch({ type: "BACK_TO_SOURCE" });
      } else {
        actions.setView("MARKETPLACES");
      }
    } else if (state.isLoading) {
      return;
    } else if (step === "source" && key.return) {
      if (source.trim()) {
        dispatch({ type: "SET_STEP", step: "scope" });
      }
    } else if (step === "source" && (key.backspace || key.delete)) {
      dispatch({ type: "DELETE_CHAR" });
    } else if (
      step === "source" &&
      input &&
      !key.ctrl &&
      !key.meta &&
      !("alt" in key && key.alt)
    ) {
      dispatch({ type: "INSERT_CHAR", text: input });
    } else if (step === "scope") {
      if (key.upArrow) {
        dispatch({
          type: "SET_SCOPE_INDEX",
          index: Math.max(0, scopeIndex - 1),
        });
      } else if (key.downArrow) {
        dispatch({
          type: "SET_SCOPE_INDEX",
          index: Math.min(SCOPES.length - 1, scopeIndex + 1),
        });
      } else if (key.return) {
        const scope = SCOPES[scopeIndex].value;
        actions.addMarketplace(source.trim(), scope);
      }
    }
  });

  if (step === "source") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Step 1/2: Enter marketplace source
        </Text>
        <Box marginTop={1}>
          <Text>Source: </Text>
          <Text color="yellow">{source}</Text>
          {!state.isLoading && <Text color="yellow">_</Text>}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter to continue, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Step 2/2: Select scope
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Source: </Text>
        <Text dimColor>{source}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {SCOPES.map((s, i) => (
          <Text key={s.value} color={i === scopeIndex ? "yellow" : "dim"}>
            {i === scopeIndex ? "> " : "  "}
            {s.label}
          </Text>
        ))}
      </Box>
      {state.isLoading && (
        <Box marginTop={1}>
          <Text color="yellow">Adding marketplace...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {state.isLoading
            ? "Please wait..."
            : "Enter to confirm, \u2191/\u2193 to navigate, Esc to go back"}
        </Text>
      </Box>
    </Box>
  );
};
