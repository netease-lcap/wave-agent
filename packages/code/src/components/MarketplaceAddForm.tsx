import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  marketplaceAddFormReducer,
  SCOPES,
  type MarketplaceAddFormState,
} from "../reducers/marketplaceAddFormReducer.js";

export const MarketplaceAddForm: React.FC = () => {
  const { state: ctxState, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(marketplaceAddFormReducer, {
    source: "",
    scopeIndex: 0,
    step: "source",
    pendingAction: null,
  } as MarketplaceAddFormState);

  // Handle side effects from reducer decisions
  useEffect(() => {
    if (!state.pendingAction) return;

    if (state.pendingAction.type === "submit") {
      actions.addMarketplace(
        state.pendingAction.source,
        state.pendingAction.scope,
      );
    } else if (state.pendingAction.type === "cancel") {
      actions.setView("MARKETPLACES");
    }

    dispatch({ type: "CLEAR_PENDING_ACTION" });
  }, [state.pendingAction, actions]);

  useInput((input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      input,
      isLoading: ctxState.isLoading,
    });
  });

  const { source, scopeIndex, step } = state;

  if (step === "source") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Step 1/2: Enter marketplace source
        </Text>
        <Box marginTop={1}>
          <Text>Source: </Text>
          <Text color="yellow">{source}</Text>
          {!ctxState.isLoading && <Text color="yellow">_</Text>}
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
          <Text key={s} color={i === scopeIndex ? "yellow" : "dim"}>
            {i === scopeIndex ? "> " : "  "}
            {s}
          </Text>
        ))}
      </Box>
      {ctxState.isLoading && (
        <Box marginTop={1}>
          <Text color="yellow">Adding marketplace...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {ctxState.isLoading
            ? "Please wait..."
            : "Enter to confirm, \u2191/\u2193 to navigate, Esc to go back"}
        </Text>
      </Box>
    </Box>
  );
};
