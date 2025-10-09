import React, { createContext, useContext } from "react";
import type { SessionData } from "wave-agent-sdk";

export interface AppConfig {
  sessionToRestore?: SessionData | null;
}

const AppContext = createContext<AppConfig | null>(null);

export const useAppConfig = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppConfig must be used within AppProvider");
  }
  return context;
};

export interface AppProviderProps extends AppConfig {
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({
  sessionToRestore,
  children,
}) => {
  return (
    <AppContext.Provider value={{ sessionToRestore }}>
      {children}
    </AppContext.Provider>
  );
};
