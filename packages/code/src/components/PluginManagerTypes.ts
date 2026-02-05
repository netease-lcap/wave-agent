import {
  KnownMarketplace,
  InstalledPlugin,
  MarketplacePluginEntry,
} from "wave-agent-sdk";

export type ViewType =
  | "DISCOVER"
  | "INSTALLED"
  | "MARKETPLACES"
  | "PLUGIN_DETAIL"
  | "MARKETPLACE_DETAIL"
  | "ADD_MARKETPLACE";

export interface PluginManagerState {
  currentView: ViewType;
  selectedId: string | null; // Plugin name or Marketplace name
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
}

export interface PluginManagerContextType {
  state: PluginManagerState;
  marketplaces: KnownMarketplace[];
  installedPlugins: (InstalledPlugin & { enabled: boolean })[];
  discoverablePlugins: (MarketplacePluginEntry & {
    marketplace: string;
    installed: boolean;
    version?: string;
  })[];
  actions: {
    setView: (view: ViewType) => void;
    setSelectedId: (id: string | null) => void;
    addMarketplace: (source: string) => Promise<void>;
    removeMarketplace: (name: string) => Promise<void>;
    updateMarketplace: (name: string) => Promise<void>;
    installPlugin: (
      name: string,
      marketplace: string,
      scope?: "user" | "project" | "local",
    ) => Promise<void>;
    uninstallPlugin: (name: string, marketplace: string) => Promise<void>;
    updatePlugin: (name: string, marketplace: string) => Promise<void>;
    refresh: () => Promise<void>;
  };
}
