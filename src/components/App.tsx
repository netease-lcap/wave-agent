import React from "react";
import { ChatInterface } from "./ChatInterface";
import { ChatProvider } from "../contexts/useChat";
import { AppProvider } from "../contexts/useAppConfig";
import type { SessionData } from "../services/sessionManager";

interface AppProps {
  workdir: string;
  sessionToRestore?: SessionData | null;
}

const AppWithProviders: React.FC = () => {
  return (
    <ChatProvider>
      <ChatInterface />
    </ChatProvider>
  );
};

export const App: React.FC<AppProps> = ({ workdir, sessionToRestore }) => {
  return (
    <AppProvider workdir={workdir} sessionToRestore={sessionToRestore}>
      <AppWithProviders />
    </AppProvider>
  );
};
