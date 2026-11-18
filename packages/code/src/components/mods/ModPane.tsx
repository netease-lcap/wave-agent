import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useInput } from "ink";
import type {
  ModPanelRenderResult,
  ModPanelUpdatePayload,
  ModPanelTree,
} from "wave-agent-sdk/types";
import { ModTreeView, collectFocusKeys } from "./ModTreeView.js";
import { ScrolledContent } from "../ScrolledContent.js";

/**
 * 终端里的一个 mod 面板（spec `ecosystem/plugin-mods.md`「终端形态」）。
 *
 * 与桌面端的 `ModPanel` 同一个数据契约：宿主只推**元信息**（`revision` /
 * `stale` / `error`），树由这里拉（spec「架构约束」: 树永远是 surface 拉的）。
 * 区别只在交互：终端没有指针，所以「点击」变成「焦点 + 键盘」。键位与 Claude
 * Code 的 `Pane` context 同义（spec「终端形态」逐字引了那张表）——
 * **方向键归滚动，不归焦点**，焦点用 `Tab` 走：
 *
 * - `↑`/`↓` 滚正文，`PageUp`/`PageDown` 翻页，`Home`/`End` 到顶/到底；
 * - `Tab`/`Shift+Tab` 在可交互节点之间移动，`Enter` 触发按钮 / 提交 `Input` /
 *   确认 `Select`（`Select` 展开时 `↑`/`↓` 归候选，局部优先）；
 * - `hotkey` 字母直接触发对应按钮；
 * - `Esc` 先收起展开的 `Select`，再按一次收起面板并把键盘还给输入框。
 *
 * 收起面板**不发 `ui.close`**：这是这一端不再画它，与桌面端关掉 tab 同一纪律
 * （mod 的 `onPress` 才决定要不要真关）。
 */
export interface ModPaneProps {
  panel: ModPanelUpdatePayload;
  /** 这一帧是不是当前激活的面板（多个 pane 时只有一个拿到键盘）。 */
  focused: boolean;
  /** 正文行数上限（终端高度换算出来的）。 */
  maxRows: number;
  /**
   * 外面要求重拉一帧的令牌（焦点翻转之后由 `ModSurface` 加一）。
   *
   * 不直接拿 `focused` 当重拉的依赖：本组件是 `ModSurface` 的子组件，子组件的
   * effect 先跑，那时 `reportModPaneView` 还没把新焦点送到引擎，拉回来的
   * `e.props.isFocused` 会是旧值。父组件「报完之后再把令牌加一」才有正确顺序。
   */
  pullToken?: number;
  renderTree: (modId: string, paneId: string) => Promise<ModPanelRenderResult>;
  /** 用户交互回传给 mod；`value` 只有 `input`（提交的文字）与 `select`（选中项）才有。 */
  onEvent: (
    kind: "press" | "input" | "select",
    key: string,
    value?: string,
  ) => void;
  /** 用户要收起这块面板（`Esc`）。 */
  onDismiss: () => void;
}

interface OpenSelect {
  key: string;
  index: number;
}

export const ModPane: React.FC<ModPaneProps> = ({
  panel,
  focused,
  maxRows,
  pullToken,
  renderTree,
  onEvent,
  onDismiss,
}) => {
  const [tree, setTree] = useState<ModPanelTree | null>(null);
  const [error, setError] = useState<string | undefined>(panel.error);
  const [focusIndex, setFocusIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [openSelect, setOpenSelect] = useState<OpenSelect | null>(null);
  const [offset, setOffset] = useState(0);
  // 正文实测行数（`ScrolledContent` 报回来的）：`End` 与翻页到最底都要知道内容
  // 有多长，否则会滚出一屏空白。
  const [totalRows, setTotalRows] = useState(0);
  // 每次拉树带一个序号：慢的回复不能盖掉新的那一帧（`revision` 单调，但两个
  // 请求可能乱序回来）。
  const pullSeq = useRef(0);

  useEffect(() => {
    const seq = ++pullSeq.current;
    let cancelled = false;
    void (async () => {
      const result = await renderTree(panel.modId, panel.paneId);
      if (cancelled || seq !== pullSeq.current) return;
      setTree(result.tree);
      setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
    // 依赖是**推送本身**（`panel` 的引用），不是 `panel.revision`：`revision` 是
    // 上一次回包时算出来的，第二次 `$.ui.invalidate` 推送带的还是同一个值，
    // 照它判重就会漏掉那一帧（桌面端是「收到 `stale` 就拉」，同一条纪律）。
    // `pullToken`：焦点翻了一帧也要重算（`e.props.isFocused` 只在拉取时出生）。
  }, [panel, pullToken, renderTree]);

  useEffect(() => {
    if (panel.error !== undefined) setError(panel.error);
  }, [panel.error]);

  const focusKeys = useMemo(
    () => (tree === null ? [] : collectFocusKeys(tree)),
    [tree],
  );
  // 树变了之后旧的焦点下标可能越界（mod 删掉了一个按钮）。
  const safeIndex =
    focusKeys.length === 0 ? 0 : Math.min(focusIndex, focusKeys.length - 1);
  const focusKey = focusKeys[safeIndex];
  const activeNode = useMemo(() => {
    if (tree === null) return undefined;
    return findNode(tree, focusKey);
  }, [tree, focusKey]);

  // 焦点换到一个 `Input` 时把草稿初始化成它的 `value`：终端没有 `onChange`，
  // 用户打的字先进本地缓冲，回车才提交给 mod。
  useEffect(() => {
    if (activeNode?.type === "Input") {
      const value = activeNode.props.value;
      setDraft(typeof value === "string" ? value : "");
    }
  }, [activeNode]);

  // 滚动位置与焦点无关（`↑`/`↓` 滚正文、`Tab` 换焦点），所以换焦点不重置它。
  // 渲染前按实测行数再夹一次：内容变短或终端变高时，不会停在一个已被裁掉的偏移上。
  // 换了一帧（mod 改了内容 / 换了文件）就回到顶部 —— 新内容停在旧偏移上等于
  // 从一个随机的中间开始读。判据与拉树同一个：一条推送 = mod 说内容变了。
  useEffect(() => setOffset(0), [panel]);
  const maxOffset = Math.max(0, totalRows - maxRows);
  const scrollOffset = Math.min(offset, maxOffset);

  const press = useCallback(
    (key: string) => {
      onEvent("press", key);
    },
    [onEvent],
  );

  useInput(
    (input, key) => {
      // `Esc`：先收候选、再收面板。焦点在面板时它不该落回输入框（输入框此时
      // 也把键盘让出来了，见 `InputBox` 的 `overlayOwnsKeyboard`）。
      if (key.escape) {
        if (openSelect) {
          setOpenSelect(null);
          return;
        }
        onDismiss();
        return;
      }

      if (openSelect && activeNode?.type === "Select") {
        const options = Array.isArray(activeNode.props.options)
          ? activeNode.props.options
          : [];
        if (key.upArrow) {
          setOpenSelect({
            ...openSelect,
            index: Math.max(0, openSelect.index - 1),
          });
          return;
        }
        if (key.downArrow) {
          setOpenSelect({
            ...openSelect,
            index: Math.min(options.length - 1, openSelect.index + 1),
          });
          return;
        }
        if (key.return) {
          const picked = options[openSelect.index];
          if (picked) onEvent("select", openSelect.key, picked.value);
          setOpenSelect(null);
          return;
        }
      }

      // 焦点：`Tab` / `Shift+Tab`。Claude Code 的 `Pane` context 里就是
      // `tab`/`shift+tab` → `abovePrompt:next/previous`，`↑`/`↓` 不归焦点。
      if (key.tab) {
        setOpenSelect(null);
        setFocusIndex((index) => {
          if (focusKeys.length === 0) return 0;
          const step = key.shift ? -1 : 1;
          return (
            (Math.min(index, focusKeys.length - 1) + step + focusKeys.length) %
            focusKeys.length
          );
        });
        return;
      }

      // 正文滚动：逐行 / 翻页 / 到顶到底，三档步长与 Claude Code 的
      // `pane:scrollUp` / `pageUp` / `top` 同义，一律夹在 `[0, maxOffset]` 里。
      if (key.upArrow) {
        setOffset(Math.max(0, scrollOffset - 1));
        return;
      }
      if (key.downArrow) {
        setOffset(Math.min(maxOffset, scrollOffset + 1));
        return;
      }
      if (key.pageUp) {
        setOffset(Math.max(0, scrollOffset - maxRows + 1));
        return;
      }
      if (key.pageDown) {
        setOffset(Math.min(maxOffset, scrollOffset + maxRows - 1));
        return;
      }
      if (key.home) {
        setOffset(0);
        return;
      }
      if (key.end) {
        setOffset(maxOffset);
        return;
      }

      // 焦点在 `Input` 上时，可打印字符归输入缓冲（与桌面端「焦点在输入框里时
      // 所有可打印键归输入框」同一条纪律）。
      if (activeNode?.type === "Input") {
        if (key.return) {
          onEvent("input", String(activeNode.props.key), draft);
          return;
        }
        if (key.backspace || key.delete) {
          setDraft((text) => text.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          setDraft((text) => text + input);
          return;
        }
      }

      if (key.return) {
        if (activeNode?.type === "Select") {
          const options = Array.isArray(activeNode.props.options)
            ? activeNode.props.options
            : [];
          if (options.length === 0) return;
          const current = activeNode.props.value;
          const index = options.findIndex((option) => option.value === current);
          setOpenSelect({
            key: String(activeNode.props.key),
            index: index >= 0 ? index : 0,
          });
          return;
        }
        if (activeNode?.type === "Button" && focusKey !== undefined) {
          press(focusKey);
          return;
        }
      }

      // 热键：面板聚焦时按那个字母等于点它（与桌面端同一语义）。
      if (input.length === 1 && tree !== null) {
        const hotkey = findHotkey(tree, input);
        if (hotkey !== undefined) press(hotkey);
      }
    },
    { isActive: focused && maxRows > 0 },
  );

  // 面板没画出来时不占键盘（`maxRows` 为 0 说明这一帧没有正文空间）——
  // 上面 `useInput` 的 `isActive` 就是这个判据。
  const visible = maxRows > 0;

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {visible ? (
        // `ScrolledContent` 才是「封顶但不多占」：内容短时保持自然高度，超了才裁。
        <ScrolledContent
          visibleRows={maxRows}
          scrollOffset={scrollOffset}
          onMeasuredRows={setTotalRows}
        >
          {tree === null ? (
            <Text dimColor>…</Text>
          ) : (
            <ModTreeView
              node={tree}
              focusKey={focusKey}
              draft={draft}
              openSelect={openSelect ?? undefined}
            />
          )}
        </ScrolledContent>
      ) : null}
    </Box>
  );
};

/** 按 `key` 找回节点（焦点高亮与 `Enter` 的语义都按它判）。 */
export function findNode(
  node: ModPanelTree,
  key: string | undefined,
): import("wave-agent-sdk/types").ModTreeNode | undefined {
  if (key === undefined || typeof node === "string") return undefined;
  if (node.props.key === key) return node;
  for (const child of node.children) {
    const found = findNode(child, key);
    if (found) return found;
  }
  return undefined;
}

/** 树里第一个 `hotkey` 匹配的按钮（字母 → `key`）。 */
function findHotkey(node: ModPanelTree, input: string): string | undefined {
  if (typeof node === "string") return undefined;
  if (node.type === "Button" && node.props.hotkey === input) {
    const key = node.props.key;
    return typeof key === "string" ? key : undefined;
  }
  for (const child of node.children) {
    const found = findHotkey(child, input);
    if (found !== undefined) return found;
  }
  return undefined;
}
