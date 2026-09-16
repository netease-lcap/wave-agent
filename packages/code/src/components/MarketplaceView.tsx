import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { KnownMarketplace } from "wave-agent-sdk";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

import { MarketplaceList } from "./MarketplaceList.js";

export const MarketplaceView: React.FC = () => {
  const {
    marketplaces,
    checkingForUpdates,
    state: managerState,
    actions,
  } = usePluginManagerContext();
  const [state, dispatch] = useReducer(selectorReducer<KnownMarketplace>, {
    selectedIndex: 0,
    pendingDecision: null,
    items: [],
  } as SelectorState<KnownMarketplace>);

  const { selectedIndex, pendingDecision, items } = state;

  // Sync marketplaces into reducer state；焦点落到当前选中的市场（新增市场后由
  // addMarketplace 设成新市场名，spec「管理市场」场景 5），没有匹配（首帧、市场被
  // 移除）时保持 SET_ITEMS 归零后的列表首项。
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: marketplaces });
    const index = marketplaces.findIndex(
      (m) => m.name === managerState.selectedId,
    );
    if (index > 0) dispatch({ type: "SET_INDEX", index });
  }, [marketplaces, managerState.selectedId]);

  useInput((input, key) => {
    if (input === "a") {
      actions.setView("ADD_MARKETPLACE");
      return;
    }

    dispatch({
      type: "HANDLE_KEY",
      key,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      const mk = items[selectedIndex];
      if (mk) {
        actions.setSelectedId(mk.name);
        actions.setView("MARKETPLACE_DETAIL");
      }
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, items, actions]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="green">Press 'a' to add a new marketplace</Text>
        {/* 打开插件管理器触发的后台清单刷新（只拉检出、不升级插件）：不阻塞
            列表浏览，完成后重读并呈现最新清单（spec ecosystem/plugin 场景 12） */}
        {checkingForUpdates && <Text dimColor> Checking for updates...</Text>}
      </Box>
      <MarketplaceList
        marketplaces={marketplaces}
        selectedIndex={selectedIndex}
      />
      {marketplaces.length > 0 && (
        <Box marginLeft={4} marginTop={1}>
          <Text dimColor>Press Enter for actions</Text>
        </Box>
      )}
    </Box>
  );
};
