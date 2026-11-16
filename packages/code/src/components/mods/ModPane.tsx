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

/** 面板正文自己有滚动条，量出来的高度这里不用。 */
const noopRows = () => {};

/**
 * 终端里的一个 mod 面板（spec `ecosystem/plugin-mods.md`「终端形态」）。
 *
 * 与桌面端的 `ModPanel` 同一个数据契约：宿主只推**元信息**（`revision` /
 * `stale` / `error`），树由这里拉（spec「架构约束」: 树永远是 surface 拉的）。
 * 区别只在交互：终端没有指针，所以「点击」变成「焦点 + 键盘」——
 *
 * - `↑`/`↓` 在可交互节点之间移动，`Enter` 触发按钮 / 提交 `Input` / 确认 `Select`；
 * - `hotkey` 字母直接触发对应按钮；
 * - `PageUp`/`PageDown` 翻正文（面板正文封顶 `maxRows` 行）；
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
  }, [panel.modId, panel.paneId, panel.revision, renderTree]);

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

  useEffect(() => {
    setOffset(0);
  }, [focusKey]);

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

      if (key.upArrow) {
        setFocusIndex((index) =>
          focusKeys.length === 0
            ? 0
            : (Math.min(index, focusKeys.length - 1) - 1 + focusKeys.length) %
              focusKeys.length,
        );
        return;
      }
      if (key.downArrow) {
        setFocusIndex((index) =>
          focusKeys.length === 0 ? 0 : (index + 1) % focusKeys.length,
        );
        return;
      }
      if (key.pageUp) {
        setOffset((value) => Math.max(0, value - maxRows + 1));
        return;
      }
      if (key.pageDown) {
        setOffset((value) => value + maxRows - 1);
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
    { isActive: focused },
  );

  const visible = maxRows > 0;

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {visible ? (
        // `ScrolledContent` 才是「封顶但不多占」：内容短时保持自然高度，超了才裁。
        <ScrolledContent
          visibleRows={maxRows}
          scrollOffset={offset}
          onMeasuredRows={noopRows}
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
