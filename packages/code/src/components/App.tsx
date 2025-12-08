import React from "react";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";

interface AppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  bypassPermissions?: boolean;
}

const AppWithProviders: React.FC<{ bypassPermissions?: boolean }> = ({
  bypassPermissions,
}) => {
  return (
    <ChatProvider bypassPermissions={bypassPermissions}>
      <ChatInterface />
    </ChatProvider>
  );
};

export const App: React.FC<AppProps> = ({
  restoreSessionId,
  continueLastSession,
  bypassPermissions,
}) => {
  return (
    <AppProvider
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
    >
      <AppWithProviders bypassPermissions={bypassPermissions} />
    </AppProvider>
  );
};
