import React, { useState, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

const SCOPES = [
  { value: "user" as const, label: "user" },
  { value: "project" as const, label: "project" },
  { value: "local" as const, label: "local" },
];

export const MarketplaceAddForm: React.FC = () => {
  const { state, actions } = usePluginManagerContext();
  const [source, setSource] = useState("");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [mode, setMode] = useState<"source" | "scope">("source");
  const sourceRef = useRef(source);

  // Keep ref in sync with state
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "scope") {
        setMode("source");
      } else {
        actions.setView("MARKETPLACES");
      }
    } else if (state.isLoading) {
      return;
    } else if (input === "q" && mode === "source") {
      setMode("scope");
    } else if (mode === "scope") {
      if (key.upArrow) {
        setScopeIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setScopeIndex((prev) => Math.min(SCOPES.length - 1, prev + 1));
      } else if (key.return) {
        setMode("source");
      }
    } else if (mode === "source" && key.return) {
      if (sourceRef.current.trim()) {
        const scope = SCOPES[scopeIndex].value;
        actions.addMarketplace(sourceRef.current.trim(), scope);
      }
    } else if (mode === "source" && (key.backspace || key.delete)) {
      setSource((prev) => prev.slice(0, -1));
    } else if (mode === "source" && input.length === 1) {
      setSource((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Add Marketplace
      </Text>
      <Box marginTop={1}>
        <Text>Source (URL or Path): </Text>
        <Text color={state.isLoading || mode !== "source" ? "gray" : "yellow"}>
          {source}
        </Text>
        {!state.isLoading && mode === "source" && <Text color="yellow">_</Text>}
      </Box>
      <Box marginTop={1}>
        <Text>Scope: </Text>
        {SCOPES.map((s, i) => (
          <Text key={s.value} color={i === scopeIndex ? "yellow" : "dim"}>
            {i === scopeIndex ? "> " : "  "}
            {s.label}{" "}
          </Text>
        ))}
        <Text dimColor> (press 'q' to change)</Text>
      </Box>
      {state.isLoading && (
        <Box marginTop={1}>
          <Text color="yellow">⌛ Adding marketplace...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {state.isLoading
            ? "Please wait..."
            : mode === "scope"
              ? "Use ↑/↓ to select, Enter to confirm, Esc to cancel"
              : "Press Enter to add, 's' to change scope, Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
};
