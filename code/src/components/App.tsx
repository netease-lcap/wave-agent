import React from "react";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";

interface AppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

const AppWithProviders: React.FC = () => {
  return (
    <ChatProvider>
      <ChatInterface />
    </ChatProvider>
  );
};

export const App: React.FC<AppProps> = ({
  restoreSessionId,
  continueLastSession,
}) => {
  return (
    <AppProvider
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
    >
      <AppWithProviders />
    </AppProvider>
  );
};
