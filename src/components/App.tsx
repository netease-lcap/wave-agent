import React from "react";
import { ChatInterface } from "./ChatInterface";
import { FileProvider } from "../contexts/useFiles";
import { ChatProvider } from "../contexts/useChat";
import { AppProvider, useAppConfig } from "../contexts/useAppConfig";
import type { SessionData } from "../services/sessionManager";

interface AppProps {
  workdir: string;
  ignore?: string[];
  sessionToRestore?: SessionData | null;
}

const AppWithProviders: React.FC = () => {
  const { workdir, ignore, sessionToRestore } = useAppConfig();

  return (
    <FileProvider workdir={workdir} ignore={ignore}>
      <ChatProvider sessionToRestore={sessionToRestore}>
        <ChatInterface />
      </ChatProvider>
    </FileProvider>
  );
};

export const App: React.FC<AppProps> = ({
  workdir,
  ignore,
  sessionToRestore,
}) => {
  return (
    <AppProvider
      workdir={workdir}
      ignore={ignore}
      sessionToRestore={sessionToRestore}
    >
      <AppWithProviders />
    </AppProvider>
  );
};
