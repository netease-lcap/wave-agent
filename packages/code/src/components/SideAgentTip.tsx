import React from "react";
import { Box, Text, useInput } from "ink";

export interface SideAgentTipProps {
  onDismiss: () => void;
}

export const SideAgentTip = ({ onDismiss }: SideAgentTipProps) => {
  useInput((input, key) => {
    if (key.escape || key.return || input === " ") {
      onDismiss();
    }
  });

  return (
    <Box>
      <Text color="gray" dimColor>
        Press{" "}
      </Text>
      <Text color="blue" bold>
        Space
      </Text>
      <Text color="gray" dimColor>
        ,{" "}
      </Text>
      <Text color="blue" bold>
        Enter
      </Text>
      <Text color="gray" dimColor>
        , or{" "}
      </Text>
      <Text color="blue" bold>
        Esc
      </Text>
      <Text color="gray" dimColor>
        {" "}
        to dismiss
      </Text>
    </Box>
  );
};

SideAgentTip.displayName = "SideAgentTip";
