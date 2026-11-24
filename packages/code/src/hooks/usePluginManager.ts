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

/** 列表落地后的状态迁移。挂载路径与事件路径共用这一份，两处只负责发起。 */
const listsSettled = (prev: PluginManagerState): PluginManagerState => ({
  ...prev,
  isLoading: false,
});

const listsFailed = (
  prev: PluginManagerState,
  error: unknown,
): PluginManagerState => ({
  ...prev,
  isLoading: false,
  error: error instanceof Error ? error.message : String(error),
});

type DiscoverablePlugin = MarketplacePluginEntry & {
  marketplace: string;
  installed: boolean;
  version?: string;
};

type ListsSnapshot = {
  marketplaces: KnownMarketplace[];
  installed: (InstalledPlugin & { enabled: boolean })[];
  discoverable: DiscoverablePlugin[];
};

/** 读三份列表（市场清单 / 已安装 / 可发现）。**纯数据**：不碰 state —— 落地交给
 *  `applyLists`。这样挂载那次可以在异步续体里落地，不必在 effect 同步段写 state。 */
async function readLists(pluginCore: PluginCore): Promise<ListsSnapshot> {
  const [mks, installed, enabledMap] = await Promise.all([
    pluginCore.listMarketplaces(),
    pluginCore.getInstalledPlugins(),
    Promise.resolve(pluginCore.getMergedEnabledPlugins()),
  ]);

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

  const allDiscoverable: DiscoverablePlugin[] = [];
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

  return {
    marketplaces: mks,
    // Only show enabled plugins in the "Installed" view
    installed: allInstalledWithEnabled.filter((p) => p.enabled),
    discoverable: allDiscoverable,
  };
}

export function usePluginManager(options?: {
  /**
   * 插件变更落盘后的回调：宿主据此置「待应用」信号并提示一次，**不重建会话**
   * （docs/specs/ecosystem/plugin.md「插件变更的就地重载」）。
   */
  onPluginChanged?: () => void;
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
  // 打开插件管理器时的后台刷新是否还在跑。初值就是 `true`：那段刷新在挂载时
  // 必然开始（下面那个 effect 的依赖 `pluginCore` / `loadLists` 都是稳定引用，
  // 一个实例只跑一次），所以不必在 effect 里再 set 一次 —— 那会先提交一帧
  // 「没在检查」。它是**独立的一轴**，并不进 `state.isLoading`：列表加载与后台
  // 刷新是并行的两条，混成一档会让界面在刷新期间被当成「还没加载完」。
  const [checkingForUpdates, setCheckingForUpdates] = useState(true);
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

  /** 把读到的三份列表落地。 */
  const applyLists = useCallback((snapshot: ListsSnapshot) => {
    setMarketplaces(snapshot.marketplaces);
    setInstalledPlugins(snapshot.installed);
    setDiscoverablePlugins(snapshot.discoverable);
  }, []);

  /** 读取并落地三份列表（不碰 isLoading，供后台刷新后重读）。 */
  const loadLists = useCallback(async () => {
    applyLists(await readLists(pluginCore));
  }, [applyLists, pluginCore]);

  /** 拉一次列表并落地 isLoading。**开头不置 loading**：挂载那次的「正在加载」由
   *  state 初值（isLoading: true）承担 —— 挂载路径上因此不写 state，也就不会先提交
   *  一帧「加载完了」再回到加载中。 */
  const fetchLists = useCallback(async () => {
    try {
      await loadLists();
      setState(listsSettled);
    } catch (error) {
      setState((prev: PluginManagerState) => listsFailed(prev, error));
    }
  }, [loadLists]);

  /** 用户 / 变更动作发起的重新加载：先置 loading（调用方是事件处理器）再拉。 */
  const refresh = useCallback(async () => {
    clearPluginFeedback();
    setState((prev: PluginManagerState) => ({
      ...prev,
      isLoading: true,
    }));
    await fetchLists();
  }, [fetchLists, clearPluginFeedback]);

  // 挂载时拉一次列表。落地写在 effect 自己那条异步链的续体里（不是 effect 的
  // 同步段），并带 `ignore` 守卫：卸载后到达的回包不再写 state。`readLists` 只取
  // 数据、不碰 state，所以 effect 的同步段里没有任何 setState。
  useEffect(() => {
    let ignore = false;
    readLists(pluginCore).then(
      (snapshot) => {
        if (ignore) return;
        applyLists(snapshot);
        setState(listsSettled);
      },
      (error: unknown) => {
        if (!ignore) {
          setState((prev: PluginManagerState) => listsFailed(prev, error));
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [applyLists, pluginCore]);

  // 打开插件管理器即后台刷新各市场检出（只拉清单、不升级任何插件；spec
  // ecosystem/plugin 场景 5/11）：刷新与列表加载并行、不阻塞界面，完成后重读
  // 列表呈现最新清单（场景 12）。失败静默——界面仍以刷新前的清单展示（场景 9）。
  useEffect(() => {
    let cancelled = false;
    pluginCore
      .refreshMarketplaces()
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        setCheckingForUpdates(false);
        await loadLists().catch(() => {});
      })
      .catch((error) => {
        // 刷新失败按上面的约定静默，但这条链尾的失败（重读列表抛错）不能变成
        // 未处理的 rejection。
        console.error("Failed to reload plugin lists:", error);
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

  // 市场详情的「批量更新插件」项：按当前清单批量升级该市场内已装插件，不拉检出
  // ——检出已由打开插件管理器时的后台刷新处理（spec ecosystem/plugin A-013 场景 14）。
  const updateMarketplace = useCallback(
    async (name: string) => {
      clearPluginFeedback();
      setState((prev: PluginManagerState) => ({
        ...prev,
        isLoading: true,
      }));
      try {
        const updated = await pluginCore.updateMarketplacePlugins(name);
        await refresh();
        setSuccessMessage(`Marketplace '${name}' updated successfully`);
        // 批量更新同属插件变更：真的升级了插件时才产生「待应用」提示
        // （spec plugin「插件变更的就地重载」场景 1）。
        if (updated > 0) options?.onPluginChanged?.();
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
        options?.onPluginChanged?.();
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
        options?.onPluginChanged?.();
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
        options?.onPluginChanged?.();
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
