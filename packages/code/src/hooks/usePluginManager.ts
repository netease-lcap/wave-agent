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
    successMessage: null,
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

  const clearPluginFeedback = useCallback(() => {
    setState((prev: PluginManagerState) => ({
      ...prev,
      error: null,
      successMessage: null,
    }));
  }, []);

  const setSuccessMessage = useCallback(
    (message: string) => {
      setState((prev: PluginManagerState) => ({
        ...prev,
        successMessage: message,
        error: null,
      }));
      setTimeout(() => {
        setState((prev: PluginManagerState) => ({
          ...prev,
          successMessage:
            prev.successMessage === message ? null : prev.successMessage,
        }));
      }, 5000);
    },
    [setState],
  );

  const refresh = useCallback(async () => {
    clearPluginFeedback();
    setState((prev: PluginManagerState) => ({
      ...prev,
      isLoading: true,
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
  }, [pluginCore, clearPluginFeedback]);

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
    async (source: string, scope: "user" | "project" | "local" = "user") => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        await pluginCore.addMarketplace(source, scope);
        await refresh();
        setSuccessMessage(`Marketplace added successfully (${scope} scope)`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const removeMarketplace = useCallback(
    async (name: string, scope?: "user" | "project" | "local") => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        await pluginCore.removeMarketplace(name, scope);
        await refresh();
        setSuccessMessage(`Marketplace '${name}' removed successfully`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const updateMarketplace = useCallback(
    async (name: string) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        await pluginCore.updateMarketplace(name);
        await refresh();
        setSuccessMessage(`Marketplace '${name}' updated successfully`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const installPlugin = useCallback(
    async (
      name: string,
      marketplace: string,
      scope: "user" | "project" | "local" = "project",
    ) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.installPlugin(pluginId, scope);
        await refresh();
        setSuccessMessage(`Plugin '${name}' installed successfully`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const uninstallPlugin = useCallback(
    async (name: string, marketplace: string) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.uninstallPlugin(pluginId);
        await refresh();
        setSuccessMessage(`Plugin '${name}' uninstalled successfully`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const updatePlugin = useCallback(
    async (name: string, marketplace: string) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        const pluginId = `${name}@${marketplace}`;
        await pluginCore.updatePlugin(pluginId);
        await refresh();
        setSuccessMessage(`Plugin '${name}' updated successfully`);
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
  );

  const toggleAutoUpdate = useCallback(
    async (name: string, enabled: boolean) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        await pluginCore.toggleAutoUpdate(name, enabled);
        await refresh();
        setSuccessMessage(
          `Auto-update for '${name}' ${enabled ? "enabled" : "disabled"}`,
        );
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage],
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
      toggleAutoUpdate,
      refresh,
      clearPluginFeedback,
    },
  };
}
