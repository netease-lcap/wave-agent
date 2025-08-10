import React, { createContext, useContext } from 'react';

export interface AppConfig {
  workdir: string;
  ignore?: string[];
}

const AppContext = createContext<AppConfig | null>(null);

export const useAppConfig = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppConfig must be used within AppProvider');
  }
  return context;
};

export interface AppProviderProps extends AppConfig {
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ workdir, ignore, children }) => {
  return <AppContext.Provider value={{ workdir, ignore }}>{children}</AppContext.Provider>;
};
