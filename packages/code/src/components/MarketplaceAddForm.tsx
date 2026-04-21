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
  const [step, setStep] = useState<"source" | "scope">("source");
  const sourceRef = useRef(source);

  // Keep ref in sync with state
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useInput((input, key) => {
    if (key.escape) {
      if (step === "scope") {
        setStep("source");
      } else {
        actions.setView("MARKETPLACES");
      }
    } else if (state.isLoading) {
      return;
    } else if (step === "source" && key.return) {
      if (sourceRef.current.trim()) {
        setStep("scope");
      }
    } else if (step === "source" && (key.backspace || key.delete)) {
      setSource((prev) => prev.slice(0, -1));
    } else if (
      step === "source" &&
      input &&
      !key.ctrl &&
      !key.meta &&
      !("alt" in key && key.alt)
    ) {
      setSource((prev) => prev + input);
    } else if (step === "scope") {
      if (key.upArrow) {
        setScopeIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setScopeIndex((prev) => Math.min(SCOPES.length - 1, prev + 1));
      } else if (key.return) {
        const scope = SCOPES[scopeIndex].value;
        actions.addMarketplace(sourceRef.current.trim(), scope);
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
