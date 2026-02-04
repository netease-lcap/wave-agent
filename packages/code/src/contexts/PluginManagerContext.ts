import { createContext, useContext } from "react";
import { PluginManagerContextType } from "../components/PluginManagerTypes.js";

export const PluginManagerContext =
  createContext<PluginManagerContextType | null>(null);

export const usePluginManagerContext = () => {
  const context = useContext(PluginManagerContext);
  if (!context) {
    throw new Error(
      "usePluginManagerContext must be used within a PluginManagerProvider",
    );
  }
  return context;
};
