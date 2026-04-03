import React from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StatusCommandProps {
  onCancel: () => void;
}

export const StatusCommand: React.FC<StatusCommandProps> = ({ onCancel }) => {
  const { sessionId, workingDirectory, getGatewayConfig, getModelConfig } =
    useChat();

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const gatewayConfig = getGatewayConfig();
  const modelConfig = getModelConfig();

  let version = "unknown";
  try {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    version = pkg.version;
  } catch {
    // Fallback if package.json cannot be read
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold underline>
          Agent Status
        </Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">Version:</Text>
        </Box>
        <Text color="white">{version}</Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">Session ID:</Text>
        </Box>
        <Text color="white">{sessionId}</Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">cwd:</Text>
        </Box>
        <Text color="white" wrap="wrap">
          {workingDirectory}
        </Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">Wave base URL:</Text>
        </Box>
        <Text color="white">{gatewayConfig.baseURL}</Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">Model:</Text>
        </Box>
        <Text color="white">{modelConfig.model}</Text>
      </Box>

      <Box>
        <Box width={20}>
          <Text color="yellow">Fast model:</Text>
        </Box>
        <Text color="white">{modelConfig.fastModel}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
};
