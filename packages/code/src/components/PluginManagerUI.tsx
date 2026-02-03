import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import {
  MarketplaceService,
  ConfigurationService,
  PluginStatus,
  PluginDetail,
  KnownMarketplace,
} from "wave-agent-sdk";
import { InstalledPluginsView } from "./PluginManagerUI/InstalledPluginsView.js";
import { MarketplaceView } from "./PluginManagerUI/MarketplaceView.js";
import { MarketplaceListView } from "./PluginManagerUI/MarketplaceListView.js";

export interface PluginManagerUIProps {
  onClose: () => void;
}

export const PluginManagerUI: React.FC<PluginManagerUIProps> = ({
  onClose,
}) => {
  const [view, setView] = useState<
    "installed" | "marketplace" | "marketplaces"
  >("installed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<PluginDetail[]>([]);
  const [marketplacePlugins, setMarketplacePlugins] = useState<PluginDetail[]>(
    [],
  );
  const [marketplaces, setMarketplaces] = useState<KnownMarketplace[]>([]);

  const marketplaceService = React.useMemo(() => new MarketplaceService(), []);
  const configService = React.useMemo(() => new ConfigurationService(), []);
  const workdir = process.cwd();

  const loadInstalledPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const installed = await marketplaceService.getInstalledPlugins();
      const enabledPlugins = configService.getMergedEnabledPlugins(workdir);

      const details: PluginDetail[] = await Promise.all(
        installed.plugins.map(async (p) => {
          const id = `${p.name}@${p.marketplace}`;
          const isEnabled = enabledPlugins[id] === true;

          let description = "";
          try {
            const mPath = marketplaceService.getMarketplacePath({
              name: p.marketplace,
              source: { source: "directory", path: "" },
            } as KnownMarketplace);
            const manifest =
              await marketplaceService.loadMarketplaceManifest(mPath);
            description =
              manifest.plugins.find((mp) => mp.name === p.name)?.description ||
              "";
          } catch {
            // Ignore
          }

          return {
            id,
            name: p.name,
            status: isEnabled ? PluginStatus.ENABLED : PluginStatus.INSTALLED,
            installedVersion: p.version,
            marketplaceName: p.marketplace,
            description,
            source: "",
          };
        }),
      );
      setInstalledPlugins(details);
    } catch (e) {
      setError(`Failed to load plugins: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [marketplaceService, configService, workdir]);

  const loadMarketplacePlugins = useCallback(async () => {
    setLoading(true);
    try {
      const marketplaces = await marketplaceService.listMarketplaces();
      const installed = await marketplaceService.getInstalledPlugins();
      const allMarketplacePlugins: PluginDetail[] = [];

      for (const m of marketplaces) {
        try {
          const mPath = marketplaceService.getMarketplacePath(m);
          const manifest =
            await marketplaceService.loadMarketplaceManifest(mPath);

          for (const p of manifest.plugins) {
            const isInstalled = installed.plugins.some(
              (ip) => ip.name === p.name && ip.marketplace === m.name,
            );

            allMarketplacePlugins.push({
              id: `${p.name}@${m.name}`,
              name: p.name,
              description: p.description,
              source: p.source,
              status: isInstalled
                ? PluginStatus.INSTALLED
                : PluginStatus.AVAILABLE,
              marketplaceName: m.name,
            });
          }
        } catch (e) {
          console.error(`Failed to load marketplace ${m.name}:`, e);
        }
      }
      setMarketplacePlugins(allMarketplacePlugins);
    } catch (e) {
      setError(`Failed to load marketplace: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [marketplaceService]);

  const loadMarketplaces = useCallback(async () => {
    setLoading(true);
    try {
      const list = await marketplaceService.listMarketplaces();
      setMarketplaces(list);
    } catch (e) {
      setError(`Failed to load marketplaces: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [marketplaceService]);

  useEffect(() => {
    if (view === "installed") {
      loadInstalledPlugins();
    } else if (view === "marketplace") {
      loadMarketplacePlugins();
    } else if (view === "marketplaces") {
      loadMarketplaces();
    }
  }, [view, loadInstalledPlugins, loadMarketplacePlugins, loadMarketplaces]);

  const views: Array<"installed" | "marketplace" | "marketplaces"> = [
    "installed",
    "marketplace",
    "marketplaces",
  ];

  useInput((input, key) => {
    if (key.escape) {
      onClose();
    }
    if (key.tab) {
      const currentIndex = views.indexOf(view);
      if (key.shift) {
        const nextIndex = (currentIndex - 1 + views.length) % views.length;
        setView(views[nextIndex]);
      } else {
        const nextIndex = (currentIndex + 1) % views.length;
        setView(views[nextIndex]);
      }
    }
  });

  const handleToggle = async (pluginId: string) => {
    const plugin = installedPlugins.find((p) => p.id === pluginId);
    if (!plugin) return;

    const newState = plugin.status !== PluginStatus.ENABLED;
    try {
      await configService.updateEnabledPlugin(
        workdir,
        "local",
        pluginId,
        newState,
      );
      await loadInstalledPlugins();
    } catch (e) {
      setError(`Failed to toggle plugin: ${(e as Error).message}`);
    }
  };

  const handleRemove = async (pluginId: string) => {
    try {
      await marketplaceService.removePlugin(pluginId);
      await configService.updateEnabledPlugin(
        workdir,
        "local",
        pluginId,
        false,
      );
      await loadInstalledPlugins();
    } catch (e) {
      setError(`Failed to remove plugin: ${(e as Error).message}`);
    }
  };

  const handleInstall = async (pluginAtMarketplace: string) => {
    setLoading(true);
    try {
      await marketplaceService.installPlugin(pluginAtMarketplace);
      await configService.updateEnabledPlugin(
        workdir,
        "local",
        pluginAtMarketplace,
        true,
      );
      await loadMarketplacePlugins();
    } catch (e) {
      setError(`Failed to install plugin: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMarketplace = async (source: string) => {
    setLoading(true);
    try {
      await marketplaceService.addMarketplace(source);
      await loadMarketplaces();
    } catch (e) {
      setError(`Failed to add marketplace: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMarketplace = async (name: string) => {
    setLoading(true);
    try {
      await marketplaceService.removeMarketplace(name);
      await loadMarketplaces();
    } catch (e) {
      setError(`Failed to remove marketplace: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateMarketplace = async (name: string) => {
    setLoading(true);
    try {
      await marketplaceService.updateMarketplace(name);
      await loadMarketplaces();
    } catch (e) {
      setError(`Failed to update marketplace: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (loading && view !== "marketplaces") {
      return (
        <Box paddingY={1}>
          <Text color="yellow">Loading...</Text>
        </Box>
      );
    }

    if (error) {
      return (
        <Box paddingY={1} flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Text dimColor>Press [Tab] to switch views and retry</Text>
        </Box>
      );
    }

    switch (view) {
      case "installed":
        return (
          <InstalledPluginsView
            plugins={installedPlugins}
            onToggle={handleToggle}
            onRemove={handleRemove}
            onUpdate={async () => {}}
            onShowDetail={() => {}}
          />
        );
      case "marketplace":
        return (
          <MarketplaceView
            plugins={marketplacePlugins}
            onInstall={handleInstall}
            onShowDetail={() => {}}
          />
        );
      case "marketplaces":
        return (
          <MarketplaceListView
            marketplaces={marketplaces}
            onAdd={handleAddMarketplace}
            onRemove={handleRemoveMarketplace}
            onUpdate={handleUpdateMarketplace}
            loading={loading}
          />
        );
      default:
        return (
          <Box paddingY={1}>
            <Text>View {view} is not implemented yet.</Text>
          </Box>
        );
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      padding={1}
      width="100%"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color="cyan" bold>
          Plugin Manager
        </Text>
        <Box>
          <Text
            color={view === "installed" ? "black" : "white"}
            backgroundColor={view === "installed" ? "cyan" : undefined}
          >
            {" "}
            Installed{" "}
          </Text>
          <Text
            color={view === "marketplace" ? "black" : "white"}
            backgroundColor={view === "marketplace" ? "cyan" : undefined}
          >
            {" "}
            Marketplace{" "}
          </Text>
          <Text
            color={view === "marketplaces" ? "black" : "white"}
            backgroundColor={view === "marketplaces" ? "cyan" : undefined}
          >
            {" "}
            Marketplaces{" "}
          </Text>
        </Box>
      </Box>

      <Box flexGrow={1} minHeight={10} flexDirection="column">
        {renderContent()}
      </Box>

      <Box
        borderStyle="single"
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text dimColor>
          Tab switch tabs • ↑↓ navigate • Enter select • Esc close
        </Text>
      </Box>
    </Box>
  );
};
