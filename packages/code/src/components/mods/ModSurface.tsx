import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalSize } from "../../contexts/useTerminalSize.js";
import { MOD_BAND_INSTANCE_ID } from "wave-agent-sdk";
import type { ModBandRenderResult } from "wave-agent-sdk";
import { useChat } from "../../contexts/useChat.js";
import { ModPane } from "./ModPane.js";
import { ModTreeView } from "./ModTreeView.js";

/**
 * 终端里的 mod 渲染区（spec `ecosystem/plugin-mods.md`「终端形态」）。
 *
 * 纵向自上而下：面板 → 输入框上方的带 → 输入框（后者由 `ChatInterface` 排）。
 * 终端没有右栏，所以面板只能落在输入框上方，一次显示一个：
 *
 * - 只有一个 pane 时不画 tab 行；
 * - 多个时顶部一行 `1: 待办   2: 检查`，焦点在面板里时数字键切换；
 * - 键盘默认留在输入框（不抢），`$.ui.open({ focus: true })` 才送进面板；
 * - 高度按终端行数分配：面板封顶 12 行、带每条封顶 6 行，缩不下就各自内部滚。
 */
/**
 * 输入区（输入框上下边框 + 状态行）占的行数，另留几行给消息区。面板与带加起来
 * 不超过终端 `rows` 的 2/3，超出来的行都算在这里（spec「终端形态」的「高度」）。
 */
const INPUT_AREA_ROWS = 8;
/** 面板正文与带的上限，以及空间紧张时的下限（spec「终端形态」）。 */
const PANE_MAX_ROWS = 12;
const PANE_MIN_ROWS = 6;
const BAND_MAX_ROWS = 6;
const BAND_MIN_ROWS = 3;

export interface ModSurfaceProps {
  /** 只画面板（`pane`）/ 只画输入框上方那条带（`band`）。 */
  part: "pane" | "band";
}

export const ModSurface: React.FC<ModSurfaceProps> = ({ part }) => {
  const {
    modPanes,
    modFocusPaneId,
    setModFocusPaneId,
    renderModPanel,
    renderModBand,
    sendModPanelEvent,
    reportModPaneView,
  } = useChat();
  const { rows } = useTerminalSize();

  const panes = useMemo(
    () => modPanes.filter((pane) => pane.paneId !== MOD_BAND_INSTANCE_ID),
    [modPanes],
  );
  // 带没有自己的 paneId（一个 mod 一条），所以「哪一帧要重拉」看这些推送的
  // revision 集合。
  const bandRevision = modPanes
    .filter((pane) => pane.paneId === MOD_BAND_INSTANCE_ID)
    .map((pane) => `${pane.modId}:${pane.revision}`)
    .join(",");

  // 这一帧画哪个 pane：焦点在哪就是谁，否则第一个。
  const activePaneId =
    modFocusPaneId ?? (panes.length > 0 ? panes[0]!.paneId : null);
  const activePane = panes.find((pane) => pane.paneId === activePaneId);

  // `Esc` 收起的面板：只是这一端不再画它，不发 `ui.close`。它下次 revision 变化
  // （mod 调了 `$.ui.open` / `invalidate`）就自己长回来。
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const activeRevision = activePane?.revision ?? 0;
  const isDismissed =
    activePane !== undefined && dismissed[activePane.paneId] === activeRevision;

  // 数字键切换面板：只在键盘在面板里时生效（焦点在输入框时数字是打字）。
  useInput(
    (input) => {
      const index = Number.parseInt(input, 10);
      if (!Number.isInteger(index) || index < 1 || index > panes.length) return;
      const target = panes[index - 1];
      if (target) setModFocusPaneId(target.paneId);
    },
    {
      isActive: part === "pane" && modFocusPaneId !== null && panes.length > 1,
    },
  );

  // 这一端摊开的是哪个面板、键盘在哪个（spec「面板的显示与焦点」）：`$.ui.panes()`
  // 的 `isShown` / `isFocused` 只认这条通道。`Esc` 收起后面板不再画，两个都报
  // `null` —— 和「没人上报过就是 false」同一个判据。
  const shownPane = isDismissed ? undefined : activePane;
  const focusedPane =
    shownPane && modFocusPaneId === shownPane.paneId ? shownPane : undefined;
  const reportedView = useRef("");
  const reportedFocus = useRef(JSON.stringify(null));
  // 焦点真的翻转之后加一，让 `ModPane` 重拉一帧（`e.props.isFocused` 是拉取那
  // 一刻算的，不重拉 mod 就看不到新值；Claude Code 那边 props 一变就重画）。
  const [pullToken, setPullToken] = useState(0);
  useEffect(() => {
    // 只由画面板的那一份上报（`part === "band"` 的兄弟与这件事无关，它一说话就把
    // 真值盖成 null 了）。
    if (part !== "pane") return;
    const shown = shownPane
      ? { modId: shownPane.modId, paneId: shownPane.paneId }
      : null;
    const focused = focusedPane
      ? { modId: focusedPane.modId, paneId: focusedPane.paneId }
      : null;
    // 每帧都会重跑：同一份快照不重复上报（按值比较，不赌引用相等）。
    const key = JSON.stringify({ shown, focused });
    if (key === reportedView.current) return;
    const focusedKey = JSON.stringify(focused);
    const focusChanged = focusedKey !== reportedFocus.current;
    reportedView.current = key;
    reportedFocus.current = focusedKey;
    reportModPaneView(shown, focused);
    // **报完再拉**：引擎要先拿到新的焦点，`ui.render` 才填得出 `e.props.isFocused`。
    if (focusChanged) setPullToken((token) => token + 1);
  }, [part, shownPane, focusedPane, reportModPaneView]);

  if (part === "pane") {
    if (!activePane || isDismissed) return null;
    // 高度：终端 2/3 减去输入区，剩下的给面板；空间不够时面板先压到最低 6 行，
    // 再不够就面板内部滚（spec「终端形态」的「高度」）。
    //
    // 插件可以用 `$.ui.open({ rows })` 申报一个更大的高度（差异面板那种「一块块
    // 读」的东西）：申报值是**上限意愿**，取它与默认封顶里大的那个，再被可用空间
    // 夹住 —— 所以申报小了不会挤、申报大了也不会撑破版面（spec「面板放得下吗」）。
    const budget = Math.floor((rows * 2) / 3) - INPUT_AREA_ROWS;
    const declared = activePane.rows ?? 0;
    const paneRows = Math.min(
      Math.max(PANE_MAX_ROWS, declared),
      Math.max(PANE_MIN_ROWS, budget),
    );
    return (
      <Box flexDirection="column">
        {panes.length > 1 ? (
          <Box gap={2}>
            {panes.slice(0, 9).map((pane, index) => (
              <Text
                key={`${pane.modId}\u0000${pane.paneId}`}
                inverse={pane.paneId === activePane.paneId}
                dimColor={pane.paneId !== activePane.paneId}
              >
                {index + 1}: {pane.title || pane.paneId}
              </Text>
            ))}
          </Box>
        ) : null}
        <Box
          flexDirection="column"
          // 面板只画上边框（仓库规则：终端里不留左右边框，`.wave/rules/cli.md`）。
          borderStyle="round"
          borderColor={modFocusPaneId === activePane.paneId ? "cyan" : "gray"}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          paddingX={1}
        >
          <ModPane
            key={`${activePane.modId}\u0000${activePane.paneId}`}
            panel={activePane}
            focused={modFocusPaneId === activePane.paneId}
            maxRows={paneRows}
            pullToken={pullToken}
            renderTree={renderModPanel}
            onEvent={(kind, key, value, scroll) =>
              sendModPanelEvent(
                activePane.modId,
                activePane.paneId,
                kind,
                key,
                value,
                scroll,
              )
            }
            onDismiss={() => {
              setDismissed((prev) => ({
                ...prev,
                [activePane.paneId]: activeRevision,
              }));
              setModFocusPaneId(null);
            }}
          />
        </Box>
      </Box>
    );
  }

  // 带的位置在面板下面：终端 2/3 的行数里面板先拿（有面板时带压到 3 行），没面板
  // 时带能用到 6 行（spec「终端形态」的「高度」：先压带）。
  const budget = Math.floor((rows * 2) / 3) - INPUT_AREA_ROWS;
  const bandRows =
    panes.length > 0
      ? budget >= PANE_MAX_ROWS
        ? BAND_MAX_ROWS
        : BAND_MIN_ROWS
      : Math.min(BAND_MAX_ROWS, Math.max(BAND_MIN_ROWS, budget));
  return (
    <ModBand
      revision={bandRevision}
      maxRows={bandRows}
      renderBand={renderModBand}
    />
  );
};

/**
 * 输入框上方那条带（spec「状态带、状态行与提示」的 `AbovePrompt` 站点）。
 *
 * 一个 mod 一条、按加载顺序纵向排列；`undefined` 的 mod 不占位置（宿主回空树，
 * 这里直接跳过）。
 */
const ModBand: React.FC<{
  revision: string;
  /** 每条带的行数上限（由 `ModSurface` 按终端高度分配）。 */
  maxRows: number;
  renderBand: () => Promise<ModBandRenderResult[]>;
}> = ({ revision, maxRows, renderBand }) => {
  const [bands, setBands] = useState<ModBandRenderResult[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const current = ++seq.current;
    void (async () => {
      const result = await renderBand();
      // 慢的回复不能盖掉新的那一帧。
      if (current !== seq.current) return;
      setBands(result);
    })();
  }, [revision, renderBand]);

  const visible = bands.filter((band) => band.tree !== null || band.error);
  if (visible.length === 0) return null;
  return (
    <Box flexDirection="column">
      {visible.map((band) => (
        <Box
          key={band.modId}
          flexDirection="column"
          // 封顶但不多占：短内容保持自然高度，超了才裁。
          maxHeight={maxRows}
          overflow="hidden"
          flexShrink={0}
        >
          {band.error ? <Text color="red">{band.error}</Text> : null}
          {band.tree !== null ? <ModTreeView node={band.tree} /> : null}
        </Box>
      ))}
    </Box>
  );
};
