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
  const [tokenInput, setTokenInput] = useState("");

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  // Resolve/reject refs for the token promise
  const tokenResolveRef = useRef<((token: string) => void) | null>(null);
  const tokenRejectRef = useRef<((err: Error) => void) | null>(null);

  // Pre-loading input: Enter starts login, Esc cancels
  useInput(
    (_, key) => {
      if (key.escape) {
        onCancel();
      }
      if (key.return && !isLoadingRef.current) {
        handleEnter();
      }
    },
    { isActive: !isLoading },
  );

  // Token input: capture keystrokes while loading
  useInput(
    (input, key) => {
      if (key.escape) {
        tokenRejectRef.current?.(new Error("cancelled"));
        onCancel();
      }
      if (key.return) {
        // Submit token
        const trimmed = tokenInput.trim();
        if (trimmed) {
          tokenResolveRef.current?.(trimmed);
        } else {
          // Empty: just clear, keep waiting
          setTokenInput("");
        }
        return;
      }
      // Backspace
      if (key.backspace && tokenInput.length > 0) {
        setTokenInput((prev) => prev.slice(0, -1));
        return;
      }
      // Regular character input (single or pasted multi-char)
      if (input && !key.ctrl && !key.meta && !key.return && input.length > 0) {
        setTokenInput((prev) => prev + input);
      }
    },
    { isActive: isLoading },
  );

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
    setTokenInput("");
    setMessage("Starting authentication...");

    // Promise that resolves when user presses Enter with token input
    const readToken = (): Promise<string> =>
      new Promise((resolve, reject) => {
        tokenResolveRef.current = resolve;
        tokenRejectRef.current = reject;
      });

    try {
      await authService.login({
        onAuthUrl: (url: string) => {
          setAuthUrl(url);
          setMessage("Paste the authorization code from your browser URL bar:");
        },
        readToken,
      });
      setMessage("Login successful");
    } catch (err) {
      const errMessage = (err as Error).message;
      if (errMessage !== "cancelled") {
        setError(errMessage);
      }
    } finally {
      tokenResolveRef.current = null;
      tokenRejectRef.current = null;
      setTokenInput("");
      setIsLoading(false);
    }
  };

  const isAuthenticated = authService.isSSOAuthenticated();
  const token = authService.getSSOToken();
  const serverUrl = process.env.WAVE_SERVER_URL;

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

      {/* Authorization code input field */}
      {isLoading && (
        <Box marginBottom={1}>
          <Text color="cyan">Code: </Text>
          <Text color="white">{tokenInput || "..."}</Text>
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
          {serverUrl && (
            <Box>
              <Text color="yellow">Server URL:</Text>
              <Text color="white"> {serverUrl}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to logout</Text>
          </Box>
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
};
