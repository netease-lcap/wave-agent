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
  ModPanelScrollRequest,
  ModPaneLayout,
  ModPanelTree,
} from "wave-agent-sdk/types";
import { useTerminalSize } from "../../contexts/useTerminalSize.js";
import { ModTreeView, collectFocusKeys } from "./ModTreeView.js";
import { ScrolledContent } from "../ScrolledContent.js";

/**
 * 终端里的一个 mod 面板（spec `ecosystem/plugin-mods.md`「终端形态」）。
 *
 * 与桌面端的 `ModPanel` 同一个数据契约：宿主只推**元信息**（`revision` /
 * `stale` / `error`），树由这里拉（spec「架构约束」: 树永远是 surface 拉的）。
 * 区别只在交互：终端没有指针，所以「点击」变成「焦点 + 键盘」。这套键位与
 * Claude Code 的 **inline（`/tui classic`）分支**同义（它 fullscreen 右侧栏那套
 * 不跟，见 spec「终端形态」）：
 *
 * - `↑`/`↓` **先问一遍 mod**（`ui.focus`，候选落点是相邻的可聚焦节点）：mod 给出
 *   落点就换焦点（列表型面板靠这条选文件），什么都不给就滚正文一行；
 * - 要滚的时候**再问一遍**（`ui.scroll`）：自己分页的 mod（差异面板的详情）收下
 *   就由它改自己的偏移、重画一帧，不收才由这一端滚；
 * - `PageUp`/`PageDown` 翻页，`Home`/`End` 到顶/到底；
 * - `Tab`/`Shift+Tab` 在可交互节点之间移动，`Enter` 触发按钮 / 提交 `Input` /
 *   确认 `Select`（`Select` 展开时 `↑`/`↓` 归候选，局部优先）；
 * - `hotkey` 字母直接触发对应按钮；
 * - `Esc` 先收起展开的 `Select`；否则**先问 mod 拦不拦**（`ui.close`）：它拦下就
 *   留着（差异面板详情里的「回列表」就是这个用法），不拦才收起面板、把键盘还给
 *   输入框。
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
  renderTree: (
    modId: string,
    paneId: string,
    layout?: ModPaneLayout,
  ) => Promise<ModPanelRenderResult>;
  /**
   * 用户交互回传给 mod；`value` 只有 `input`（提交的文字）与 `select`（选中项）
   * 才有，`scroll` 只有滚动键才有。
   */
  onEvent: (
    kind: "press" | "input" | "select" | "focus" | "close" | "scroll",
    key: string,
    value?: string,
    scroll?: ModPanelScrollRequest,
  ) => Promise<Partial<import("wave-agent-sdk/types").ModPanelEventResult>>;
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
  // `autoFocus` 只播种一次：第一棵带可聚焦节点的树到货时（见拉树那个 effect）。
  const seeded = useRef(false);
  // mod 把焦点指到一个这一帧还没有的节点（它顺手让窗口挪了一格，落点是刚进来的
  // 那一行）：等下一帧的树到了再落，别把这次方向键丢掉。
  const pendingFocusKey = useRef<string | undefined>(undefined);
  const { columns, rows } = useTerminalSize();
  // 报给 mod 的版面事实（`e.props`，spec「`ui.render` 的 `e.props`」）：终端永远
  // 把面板放在输入框上方，`bodyRows` 是这一帧正文真能用的行数（面板封顶 12 行、
  // 空间不够再压 —— `maxRows` 就是 `ModSurface` 算出来的那个）。宽度扣掉外面那个
  // 盒子的左右内边距（`ModSurface` 的 `paddingX={1}`）。
  const layout: ModPaneLayout = useMemo(
    () => ({
      placement: "inline",
      columns,
      rows,
      bodyRows: maxRows,
      bodyColumns: Math.max(1, columns - 2),
    }),
    [maxRows, columns, rows],
  );

  useEffect(() => {
    const seq = ++pullSeq.current;
    let cancelled = false;
    void (async () => {
      const result = await renderTree(panel.modId, panel.paneId, layout);
      if (cancelled || seq !== pullSeq.current) return;
      setTree(result.tree);
      setError(result.error);
      // 面板长出来的第一棵树：焦点落到标了 `autoFocus` 的那个控件上（spec
      // 「元素表」：一个站点里多个只认第一个）。只播种一次 —— 之后换焦点归用户，
      // mod 重画一帧不该把焦点拽回去。桌面端同一语义（Node 的 `autoFocus`）。
      //
      // 必须和 `setTree` 在同一批里：放进 `useEffect` 会先提交一帧「树已经画出来、
      // 焦点还在第一个」，下一帧才跳过去 —— 终端上是一闪，测试里是一帧内容对、
      // 焦点错的中间态（`waitFor` 只看内容，会在那一帧就放行）。
      if (!seeded.current && result.tree !== null) {
        const keys = collectFocusKeys(result.tree);
        if (keys.length > 0) {
          seeded.current = true;
          const target = findAutoFocus(result.tree);
          const at = target === undefined ? -1 : keys.indexOf(target);
          if (at >= 0) setFocusIndex(at);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // 依赖是**推送本身**（`panel` 的引用），不是 `panel.revision`：`revision` 是
    // 上一次回包时算出来的，第二次 `$.ui.invalidate` 推送带的还是同一个值，
    // 照它判重就会漏掉那一帧（桌面端是「收到 `stale` 就拉」，同一条纪律）。
    // `pullToken`：焦点翻了一帧也要重算（`e.props.isFocused` 只在拉取时出生）。
    // 版面（`layout`）变了也要重拉：`e.props.scroll.bodyRows` 是 mod 分页的依据，
    // 变了它得按新窗口重画（`layout` 自己是 memo，值一样时引用也不变）。
  }, [panel, pullToken, renderTree, layout]);

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

  // 上一帧欠下的落点：这一帧的树到了就落上去。
  useEffect(() => {
    const pending = pendingFocusKey.current;
    if (pending === undefined) return;
    const at = focusKeys.indexOf(pending);
    if (at < 0) return;
    pendingFocusKey.current = undefined;
    setFocusIndex(at);
  }, [focusKeys]);

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
      void onEvent("press", key);
    },
    [onEvent],
  );

  /**
   * `↑`/`↓`：先问一遍 mod 落点（spec「`ui.focus`：方向键先问 mod」）。
   *
   * 候选落点是相邻的可聚焦节点；mod 接住就把焦点放到它给的控件上（列表型面板
   * 靠这条选文件），这一下方向键不再滚正文；mod 不管就落回默认行为 —— 滚一行。
   * 与 Claude Code 的 inline（`/tui classic`）分支同一套语义。
   *
   * 不用 `useCallback`：`useInput` 每帧重新登记处理函数，直接闭包住这一帧的
   * 焦点表与滚动上限最准（包一层 memo 反而会读到旧值）。
   */
  const arrow = async (step: -1 | 1) => {
    const count = focusKeys.length;
    if (count > 0) {
      const candidate = focusKeys[(safeIndex + step + count) % count];
      if (candidate !== undefined) {
        const result = await onEvent("focus", candidate);
        if (result.handled) {
          const target = result.element;
          if (target !== undefined) {
            const at = focusKeys.indexOf(target);
            if (at >= 0) setFocusIndex(at);
            else pendingFocusKey.current = target;
          }
          return;
        }
      }
    }
    await scrollBy(step, () =>
      setOffset(
        step === -1
          ? Math.max(0, scrollOffset - 1)
          : Math.min(maxOffset, scrollOffset + 1),
      ),
    );
  };

  /**
   * 滚动：**先问一遍 mod**（`ui.scroll`，spec「`ui.scroll`：mod 自己滚」）。
   *
   * 自己分页的 mod（差异面板的详情）收下这一下就把自己的窗口挪一行、重画一帧 ——
   * 它的树因此永远装得下，宿主的滚动层对它来说是空的；不收才落回这一端的偏移。
   *
   * `by` 是**行**：`↑`/`↓` 是 ±1，翻页是 ±(可见行数 - 1)，`Home`/`End` 给
   * `Number.MAX_SAFE_INTEGER`（「要多少滚多少」，mod 按自己的内容长度夹住）。
   */
  const scrollBy = async (by: number, fallback: () => void) => {
    const offset = Math.max(0, Math.min(maxOffset, scrollOffset + by));
    const result = await onEvent("scroll", "", undefined, {
      by,
      offset,
      contentRows: totalRows,
      bodyRows: maxRows,
    });
    if (result.handled) return;
    fallback();
  };

  /**
   * `Esc` 收起面板：**先问一遍 mod**（`ui.close`）。它拦下就什么都不做 —— 此刻
   * 它一般已经把面板画回了上一级（差异面板详情里的「回列表」），这一端照新一帧
   * 重画即可；不拦才真的收起来、把键盘还给输入框（与桌面端关 tab 同一条纪律：
   * 收起只是这一端不再画它，下一次 `$.ui.open` / `invalidate` 它自己长回来）。
   */
  const dismiss = async () => {
    const result = await onEvent("close", "");
    if (result.handled) return;
    onDismiss();
  };

  useInput(
    (input, key) => {
      // `Esc`：先收候选、再问 mod、最后才收面板。焦点在面板时它不该落回输入框
      // （输入框此时也把键盘让出来了，见 `InputBox` 的 `overlayOwnsKeyboard`）。
      if (key.escape) {
        if (openSelect) {
          setOpenSelect(null);
          return;
        }
        void dismiss();
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
          if (picked) void onEvent("select", openSelect.key, picked.value);
          setOpenSelect(null);
          return;
        }
      }

      // 焦点：`Tab` / `Shift+Tab`。Claude Code 的 `Pane` context 里就是
      // `tab`/`shift+tab` → `abovePrompt:next/previous`。
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

      // 方向键：先问一遍 mod（`ui.focus`），没人接就滚正文 —— 见 `arrow`。
      if (key.upArrow) {
        void arrow(-1);
        return;
      }
      if (key.downArrow) {
        void arrow(1);
        return;
      }
      // 翻页与到顶到底：与 Claude Code 的 `pane:pageUp` / `top` / `bottom` 同义，
      // 一律夹在 `[0, maxOffset]` 里。
      if (key.pageUp) {
        void scrollBy(-(maxRows - 1), () =>
          setOffset(Math.max(0, scrollOffset - maxRows + 1)),
        );
        return;
      }
      if (key.pageDown) {
        void scrollBy(maxRows - 1, () =>
          setOffset(Math.min(maxOffset, scrollOffset + maxRows - 1)),
        );
        return;
      }
      // `Home` / `End`：给一个「要多少滚多少」的极大步长，自己分页的 mod 按它
      // 自己那份内容夹住（Claude Code 的插件也是这么认的）。
      if (key.home) {
        void scrollBy(-Number.MAX_SAFE_INTEGER, () => setOffset(0));
        return;
      }
      if (key.end) {
        void scrollBy(Number.MAX_SAFE_INTEGER, () => setOffset(maxOffset));
        return;
      }

      // 焦点在 `Input` 上时，可打印字符归输入缓冲（与桌面端「焦点在输入框里时
      // 所有可打印键归输入框」同一条纪律）。
      if (activeNode?.type === "Input") {
        if (key.return) {
          void onEvent("input", String(activeNode.props.key), draft);
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

/** 树里第一个标了 `autoFocus` 的可聚焦节点（深度优先、与 `collectFocusKeys` 同序）。 */
function findAutoFocus(node: ModPanelTree): string | undefined {
  if (typeof node === "string") return undefined;
  const key = node.props.key;
  if (
    (node.type === "Button" ||
      node.type === "Input" ||
      node.type === "Select") &&
    node.props.autoFocus === true &&
    typeof key === "string" &&
    key !== ""
  ) {
    return key;
  }
  for (const child of node.children) {
    const found = findAutoFocus(child);
    if (found !== undefined) return found;
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
