import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { execFile } from "child_process";
import { promisify } from "util";
import { authService } from "wave-agent-sdk";
import { createBracketedPasteDetector } from "../utils/bracketedPaste.js";

const execFileAsync = promisify(execFile);

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    execFileAsync("open", [url]).catch(() => {});
  } else if (platform === "win32") {
    execFileAsync("cmd", ["/c", "start", "", url]).catch(() => {});
  } else {
    execFileAsync("xdg-open", [url]).catch(() => {});
  }
  // Failures are ignored — URL is still displayed in the UI for manual copy
}

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

  // Detects and strips bracketed paste markers (\x1b[200~ ... \x1b[201~)
  // that terminals wrap pasted text in. Unlike the main InputBox pipeline,
  // this overlay's token input goes through raw ink useInput, which only
  // strips ONE leading ESC, leaving the markers (e.g. "[200~") in the input.
  const pasteDetectorRef = useRef(createBracketedPasteDetector());

  // Resolve/reject refs for the token promise
  const tokenResolveRef = useRef<((token: string) => void) | null>(null);
  const tokenRejectRef = useRef<((err: Error) => void) | null>(null);

  // Single useInput handler — branches on isLoading to avoid the
  // isActive transition race that drops stdin between hook swaps.
  useInput((input, key) => {
    if (!isLoadingRef.current) {
      // Pre-loading mode: Enter starts login, Esc cancels
      if (key.escape) {
        onCancel();
      }
      if (key.return) {
        handleEnter();
      }
      return;
    }

    // Token input mode: capture keystrokes while loading
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
    // Regular character input (single or pasted multi-char). Run through the
    // bracketed paste detector: a pasted token arrives wrapped in
    // \x1b[200~ ... \x1b[201~ markers (possibly split across chunks), which
    // must be stripped instead of being appended to the token.
    if (input && !key.ctrl && !key.meta && !key.return && input.length > 0) {
      const result = pasteDetectorRef.current.process(input);

      if (result.kind === "consume") {
        // In-flight bracketed paste content: hold it; the final chunk
        // delivers the complete text.
        return;
      }

      if (result.kind === "paste") {
        // Tokens never contain carriage returns — drop \r (CRLF terminals
        // send \r, not \n, in pasted text).
        const leading = result.leadingInput?.replace(/\r/g, "");
        if (leading) {
          setTokenInput((prev) => prev + leading);
        }
        const text = result.text.replace(/\r/g, "");
        if (text) {
          setTokenInput((prev) => prev + text);
        }
        return;
      }

      setTokenInput((prev) => prev + result.input);
    }
  });

  const handleEnter = async () => {
    if (isLoadingRef.current) return;

    // A stale-but-present SSO token still counts as logged in; it refreshes
    // lazily on the next API call. Enter toggles logout only when a token exists.
    const isAuthenticated = Boolean(authService.getSSOToken());
    if (isAuthenticated) {
      await authService.clearAuth();
      setMessage("Logged out successfully");
      return;
    }

    setIsLoading(true);
    setError("");
    setAuthUrl("");
    setTokenInput("");
    pasteDetectorRef.current.reset();
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
          openBrowser(url);
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

  const isAuthenticated = Boolean(authService.getSSOToken());
  const token = authService.getSSOToken();
  const serverUrl = authService.getServerUrl();

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
