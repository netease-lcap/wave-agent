import React from "react";
import { Box, render, Text } from "ink";
import { ConfirmationComponent } from "../src/components/ConfirmationComponent.js";
import type { PermissionDecision } from "wave-agent-sdk";

const ExampleApp: React.FC = () => {
  const [decision, setDecision] = React.useState<PermissionDecision | null>(
    null,
  );
  const [cancelled, setCancelled] = React.useState(false);

  const handleDecision = (decision: PermissionDecision) => {
    setDecision(decision);
  };

  const handleCancel = () => {
    setCancelled(true);
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

  if (cancelled) {
    return (
      <Box padding={1}>
        <Text color="red">Operation cancelled</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        ConfirmationComponent Example
      </Text>
      <Text>Press keys to interact with the component:</Text>
      <Box marginTop={1}>
        <ConfirmationComponent
          toolName="Edit"
          onDecision={handleDecision}
          onCancel={handleCancel}
        />
      </Box>
    </Box>
  );
};

render(<ExampleApp />);
