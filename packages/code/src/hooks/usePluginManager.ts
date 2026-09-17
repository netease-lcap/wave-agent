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

export function usePluginManager(options?: {
  onPluginInstalled?: () => void;
}): PluginManagerContextType {
  const [state, setState] = useState<PluginManagerState>({
    currentView: "DISCOVER",
    selectedId: null,
    isLoading: true,
    error: null,
    successMessage: null,
    searchQuery: "",
  });

  const [marketplaces, setMarketplaces] = useState<KnownMarketplace[]>([]);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
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

  /** 读取市场清单 + 已安装插件 + 可发现插件（不碰 isLoading，供后台刷新后重读）。 */
  const loadLists = useCallback(async () => {
    const [mks, installed, enabledMap] = await Promise.all([
      pluginCore.listMarketplaces(),
      pluginCore.getInstalledPlugins(),
      Promise.resolve(pluginCore.getMergedEnabledPlugins()),
    ]);

    setMarketplaces(mks);
    // 同一插件在本机可能有多条安装记录（各作用域/各项目一条，spec plugin A-015）；
    // 「已安装」列表按插件去重，否则同一个插件会重复成行。
    const listedPlugins = new Set<string>();
    const allInstalledWithEnabled = installed.plugins
      .filter((p) => {
        const pluginId = `${p.name}@${p.marketplace}`;
        if (listedPlugins.has(pluginId)) return false;
        listedPlugins.add(pluginId);
        return true;
      })
      .map((p) => {
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
  }, [pluginCore]);

  const refresh = useCallback(async () => {
    clearPluginFeedback();
    setState((prev: PluginManagerState) => ({
      ...prev,
      isLoading: true,
    }));
    try {
      await loadLists();
      setState((prev: PluginManagerState) => ({ ...prev, isLoading: false }));
    } catch (error) {
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [loadLists, clearPluginFeedback]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 打开插件管理器即后台刷新各市场检出（只拉清单、不升级任何插件；spec
  // ecosystem/plugin 场景 5/11）：刷新与列表加载并行、不阻塞界面，完成后重读
  // 列表呈现最新清单（场景 12）。失败静默——界面仍以刷新前的清单展示（场景 9）。
  useEffect(() => {
    let cancelled = false;
    setCheckingForUpdates(true);
    pluginCore
      .refreshMarketplaces()
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        setCheckingForUpdates(false);
        await loadLists().catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [pluginCore, loadLists]);

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
        const marketplace = await pluginCore.addMarketplace(source, scope);
        await refresh();
        setSuccessMessage(`Marketplace added successfully (${scope} scope)`);
        // 焦点落到新加的市场（spec plugin「管理市场」场景 5）：刷新会把市场列表的
        // 选中项归零，这里用 addMarketplace 的返回值（市场名由市场自身清单决定，
        // 调用方事先不知道）把选中项设为新市场；失败路径不设置，保持原选中不变。
        setState((prev: PluginManagerState) => ({
          ...prev,
          selectedId: marketplace.name,
          currentView: "MARKETPLACES",
        }));
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
        setState((prev: PluginManagerState) => ({
          ...prev,
          currentView: "MARKETPLACES",
        }));
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
        options?.onPluginInstalled?.();
      } catch (error) {
        setState((prev: PluginManagerState) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [pluginCore, refresh, clearPluginFeedback, setSuccessMessage, options],
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

  return {
    state,
    marketplaces,
    checkingForUpdates,
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
      clearPluginFeedback,
    },
  };
}
