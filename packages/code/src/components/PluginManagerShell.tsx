import React from "react";
import { Box, Text, useInput } from "ink";
import { ViewType } from "./PluginManagerTypes.js";
import { usePluginManager } from "../hooks/usePluginManager.js";
import { DiscoverView } from "./DiscoverView.js";
import { InstalledView } from "./InstalledView.js";
import { MarketplaceView } from "./MarketplaceView.js";
import { MarketplaceDetail } from "./MarketplaceDetail.js";
import { PluginDetail } from "./PluginDetail.js";
import { MarketplaceAddForm } from "./MarketplaceAddForm.js";
import { PluginManagerContext } from "../contexts/PluginManagerContext.js";

export const PluginManagerShell: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const pluginManager = usePluginManager();
  const { state, actions, discoverablePlugins } = pluginManager;

  const setView = (view: ViewType) => {
    if (
      view !== "PLUGIN_DETAIL" &&
      view !== "MARKETPLACE_DETAIL" &&
      view !== "ADD_MARKETPLACE"
    ) {
      actions.setSelectedId(null);
    }
    actions.setView(view);
  };

  useInput((input, key) => {
    if (key.tab) {
      const views: ViewType[] = ["DISCOVER", "INSTALLED", "MARKETPLACES"];
      const currentIndex = views.indexOf(
        state.currentView === "PLUGIN_DETAIL"
          ? discoverablePlugins.find(
              (p) => `${p.name}@${p.marketplace}` === state.selectedId,
            )
            ? "DISCOVER"
            : "INSTALLED"
          : state.currentView === "MARKETPLACE_DETAIL" ||
              state.currentView === "ADD_MARKETPLACE"
            ? "MARKETPLACES"
            : state.currentView,
      );

      let nextIndex;
      if (key.shift) {
        nextIndex = (currentIndex - 1 + views.length) % views.length;
      } else {
        nextIndex = (currentIndex + 1) % views.length;
      }
      setView(views[nextIndex]);
    }
    if (key.escape) {
      if (state.currentView === "PLUGIN_DETAIL") {
        const isFromDiscover = discoverablePlugins.find(
          (p) => `${p.name}@${p.marketplace}` === state.selectedId,
        );
        setView(isFromDiscover ? "DISCOVER" : "INSTALLED");
      } else if (
        state.currentView === "MARKETPLACE_DETAIL" ||
        state.currentView === "ADD_MARKETPLACE"
      ) {
        setView("MARKETPLACES");
      }
    }
  });

  const renderView = () => {
    if (state.isLoading && !state.selectedId) {
      return (
        <Box padding={1}>
          <Text color="yellow">Loading...</Text>
        </Box>
      );
    }

    switch (state.currentView) {
      case "DISCOVER":
        return <DiscoverView />;
      case "INSTALLED":
        return <InstalledView />;
      case "MARKETPLACES":
        return <MarketplaceView />;
      case "MARKETPLACE_DETAIL":
        return <MarketplaceDetail />;
      case "PLUGIN_DETAIL":
        return <PluginDetail />;
      case "ADD_MARKETPLACE":
        return <MarketplaceAddForm />;
      default:
        return <DiscoverView />;
    }
  };

  return (
    <PluginManagerContext.Provider value={pluginManager}>
      <Box
        flexDirection="column"
        width="100%"
        height="100%"
        borderStyle="round"
        borderColor="cyan"
      >
        <Box
          paddingX={1}
          borderStyle="single"
          borderBottom={true}
          borderTop={false}
          borderLeft={false}
          borderRight={false}
        >
          <Box marginRight={2}>
            <Text bold color="cyan">
              Plugin Manager
            </Text>
          </Box>
          <Box>
            <Text
              color={
                state.currentView === "DISCOVER" ||
                (state.currentView === "PLUGIN_DETAIL" &&
                  !!discoverablePlugins.find(
                    (p) => `${p.name}@${p.marketplace}` === state.selectedId,
                  ))
                  ? "yellow"
                  : undefined
              }
            >
              {" "}
              Discover{" "}
            </Text>
            <Text
              color={
                state.currentView === "INSTALLED" ||
                (state.currentView === "PLUGIN_DETAIL" &&
                  !discoverablePlugins.find(
                    (p) => `${p.name}@${p.marketplace}` === state.selectedId,
                  ))
                  ? "yellow"
                  : undefined
              }
            >
              {" "}
              Installed{" "}
            </Text>
            <Text
              color={
                state.currentView === "MARKETPLACES" ||
                state.currentView === "MARKETPLACE_DETAIL" ||
                state.currentView === "ADD_MARKETPLACE"
                  ? "yellow"
                  : undefined
              }
            >
              {" "}
              Marketplaces{" "}
            </Text>
          </Box>
        </Box>

        <Box flexGrow={1} flexDirection="column" padding={1}>
          {renderView()}
          {children}
        </Box>

        <Box
          paddingX={1}
          borderStyle="single"
          borderTop={true}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        >
          <Text dimColor>
            {state.isLoading
              ? "Loading..."
              : "Use Tab to switch views, arrows to navigate, Enter to select, Esc to go back"}
          </Text>
          {state.error && (
            <Box marginLeft={2}>
              <Text color="red">Error: {state.error}</Text>
            </Box>
          )}
        </Box>
      </Box>
    </PluginManagerContext.Provider>
  );
};
