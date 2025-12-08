import React from "react";
import { Box, render, Text } from "ink";
import { Confirmation } from "../src/components/Confirmation.js";
import type { PermissionDecision } from "wave-agent-sdk";

const ExampleApp: React.FC = () => {
  const [decision, setDecision] = React.useState<PermissionDecision | null>(
    null,
  );
  const [cancelled, setCancelled] = React.useState(false);

  const [aborted, setAborted] = React.useState(false);

  const handleDecision = (decision: PermissionDecision) => {
    setDecision(decision);
  };

  const handleCancel = () => {
    setCancelled(true);
  };

  const handleAbort = () => {
    setAborted(true);
  };

  if (decision) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green" bold>
          Decision Made:
        </Text>
        <Text>Behavior: {decision.behavior}</Text>
        {decision.message && <Text>Message: {decision.message}</Text>}
      </Box>
    );
  }

  if (cancelled || aborted) {
    return (
      <Box padding={1}>
        <Text color="red">Operation {cancelled ? "cancelled" : "aborted"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        Confirmation Example
      </Text>
      <Text>Press keys to interact with the component:</Text>
      <Box marginTop={1}>
        <Confirmation
          toolName="Edit"
          onDecision={handleDecision}
          onCancel={handleCancel}
          onAbort={handleAbort}
        />
      </Box>
    </Box>
  );
};

render(<ExampleApp />);
