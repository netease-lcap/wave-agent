import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { authService } from "wave-agent-sdk";

export interface LoginCommandProps {
  onCancel: () => void;
}

export const LoginCommand: React.FC<LoginCommandProps> = ({ onCancel }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authUrl, setAuthUrl] = useState("");

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
    }
    if (key.return && !isLoadingRef.current) {
      handleEnter();
    }
  });

  const handleEnter = async () => {
    if (isLoadingRef.current) return;

    const isAuthenticated = authService.isSSOAuthenticated();
    if (isAuthenticated) {
      authService.clearAuth();
      setMessage("Logged out successfully");
      return;
    }

    setIsLoading(true);
    setError("");
    setAuthUrl("");
    setMessage("Waiting for browser authentication...");

    try {
      await authService.login((url: string) => {
        setAuthUrl(url);
      });
      setMessage("Login successful");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const isAuthenticated = authService.isSSOAuthenticated();
  const token = authService.getSSOToken();
  const adminUrl = process.env.WAVE_ADMIN_URL;

  const truncatedToken =
    token && token.length > 14
      ? `${token.substring(0, 10)}...${token.substring(token.length - 4)}`
      : (token ?? "");

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
          SSO Authentication
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {message && !error && (
        <Box marginBottom={1}>
          <Text color={isLoading ? "yellow" : "green"}>
            {isLoading ? "⌛ " : ""}
            {message}
          </Text>
        </Box>
      )}

      {authUrl && isLoading && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan">Open this URL in your browser:</Text>
          <Text color="white">{authUrl}</Text>
        </Box>
      )}

      {!isAuthenticated && !isLoading && (
        <>
          <Box>
            <Text color="yellow">Status:</Text>
            <Text color="white"> Not logged in</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to login</Text>
          </Box>
        </>
      )}

      {isAuthenticated && !isLoading && !message && (
        <>
          <Box>
            <Text color="yellow">Status:</Text>
            <Text color="green"> Authenticated</Text>
          </Box>
          <Box>
            <Text color="yellow">Token:</Text>
            <Text color="white"> {truncatedToken}</Text>
          </Box>
          {adminUrl && (
            <Box>
              <Text color="yellow">Admin URL:</Text>
              <Text color="white"> {adminUrl}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to logout</Text>
          </Box>
        </>
      )}

      {isAuthenticated && message && !error && (
        <Box marginTop={1}>
          <Text dimColor>Esc to close</Text>
        </Box>
      )}

      {!isAuthenticated && !isLoading && !error && (
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
};
