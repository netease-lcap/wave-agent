import { useState, useCallback, useEffect, useMemo } from "react";
import {
  PluginCore,
  KnownMarketplace,
  InstalledPlugin,
  MarketplacePluginEntry,
} from "wave-agent-sdk";
import {
  PluginManagerState,
  ViewType,
  PluginManagerContextType,
} from "../components/PluginManagerTypes.js";

export function usePluginManager(): PluginManagerContextType {
  const [state, setState] = useState<PluginManagerState>({
    currentView: "DISCOVER",
    selectedId: null,
    isLoading: true,
    error: null,
    searchQuery: "",
  });

  const [marketplaces, setMarketplaces] = useState<KnownMarketplace[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<
    (InstalledPlugin & { enabled: boolean })[]
  >([]);
  const [discoverablePlugins, setDiscoverablePlugins] = useState<
    (MarketplacePluginEntry & {
      marketplace: string;
      installed: boolean;
      version?: string;
    })[]
  >([]);

  const pluginCore = useMemo(() => new PluginCore(), []);

  const refresh = useCallback(async () => {
    setState((prev: PluginManagerState) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));
    try {
      const [mks, installed, enabledMap] = await Promise.all([
        pluginCore.listMarketplaces(),
        pluginCore.getInstalledPlugins(),
        Promise.resolve(pluginCore.getMergedEnabledPlugins()),
      ]);

      setMarketplaces(mks);
      const allInstalledWithEnabled = installed.plugins.map((p) => {
        const pluginId = `${p.name}@${p.marketplace}`;
        return {
          ...p,
          enabled: !!enabledMap[pluginId],
          scope: pluginCore.findPluginScope(pluginId) || undefined,
        };
      });

      // Only show enabled plugins in the "Installed" view
      setInstalledPlugins(allInstalledWithEnabled.filter((p) => p.enabled));

      const allDiscoverable: (MarketplacePluginEntry & {
        marketplace: string;
        installed: boolean;
        version?: string;
      })[] = [];
      for (const mk of mks) {
        try {
          const manifest = await pluginCore.loadMarketplaceManifest(
            pluginCore.getMarketplacePath(mk),
          );
          manifest.plugins.forEach((p) => {
            const pluginId = `${p.name}@${mk.name}`;
            const isInstalled = installed.plugins.find(
              (ip) => ip.name === p.name && ip.marketplace === mk.name,
            );
            const isEnabled = !!enabledMap[pluginId];

            // Show in Discover if not installed OR if installed but not enabled in current scope
            if (!isInstalled || !isEnabled) {
              allDiscoverable.push({
                ...p,
                marketplace: mk.name,
                installed: !!isInstalled,
              });
            }
          });
        } catch {
          // Skip marketplaces that fail to load
        }
      }
      setDiscoverablePlugins(allDiscoverable);
      setState((prev: PluginManagerState) => ({ ...prev, isLoading: false }));
    } catch (error) {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [pluginCore]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setView = useCallback((view: ViewType) => {
    setState((prev: PluginManagerState) => ({ ...prev, currentView: view }));
  }, []);

  const setSelectedId = useCallback((id: string | null) => {
    setState((prev: PluginManagerState) => ({ ...prev, selectedId: id }));
  }, []);

  const addMarketplace = useCallback(
    async (source: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        await pluginCore.addMarketplace(source);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  const removeMarketplace = useCallback(
    async (name: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        await pluginCore.removeMarketplace(name);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  const updateMarketplace = useCallback(
    async (name: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        await pluginCore.updateMarketplace(name);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  const installPlugin = useCallback(
    async (
      name: string,
      marketplace: string,
      scope: "user" | "project" | "local" = "project",
    ) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.installPlugin(pluginId, scope);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  const uninstallPlugin = useCallback(
    async (name: string, marketplace: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.uninstallPlugin(pluginId);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  const updatePlugin = useCallback(
    async (name: string, marketplace: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.updatePlugin(pluginId);
        await refresh();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh],
  );

  return {
    state,
    marketplaces,
    installedPlugins,
    discoverablePlugins,
    actions: {
      setView,
      setSelectedId,
      addMarketplace,
      removeMarketplace,
      updateMarketplace,
      installPlugin,
      uninstallPlugin,
      updatePlugin,
      refresh,
    },
  };
}
