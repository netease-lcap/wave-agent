import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  OUTLINE_RAIL_ARROW_SLOT_PX,
  OUTLINE_TICK_BOX_PX,
  OUTLINE_TICK_GAP_PX,
  OUTLINE_TICK_PITCH_PX,
  outlineCardTop,
  outlineRailListHeight,
  outlineRailOverflows,
  outlineRailScrollStep,
  outlineTickWidth,
  shouldShowOutline,
  type TranscriptOutlineItem,
} from "../utils/transcriptOutline";
import { ChevronIcon } from "./ChevronIcon";
import "../styles/TranscriptOutline.css";

export interface TranscriptOutlineProps {
  items: readonly TranscriptOutlineItem[];
  /** 当前这一轮（视口顶之上最近的那条用户消息）的 id。 */
  activeId?: string;
  /**
   * 此刻**落在滚动面里**的用户消息 id（可能是多条）。指针移开之后刻度只剩一长
   * 一短的节奏，光看节奏分不出「哪几轮现在就在眼前」，所以这几条的颜色要留在
   * 悬停档（设计师 1110：「鼠标移开后……对应的会话如果已经在界面内，相应的刻度
   * 颜色要深一些，可以用现在的 hover 色」）。宽度不参与——宽度只归节奏与悬停。
   */
  visibleIds?: readonly string[];
  /** 内容列的实际宽度，决定大纲显不显示。0 = 还没测到。 */
  columnWidth: number;
  /** 滚动容器的可视高度，决定刻度间距、垂直居中位置与刻度条的最大高度。 */
  viewportHeight: number;
  /** 内容列左侧的留白（列左边缘到滚动容器左边缘），决定大纲显不显示。 */
  columnInset: number;
  /** 点了某个刻度：把该消息落位（父组件的 scrollToMessage）。 */
  onJump: (id: string) => void;
}

/** 预览卡宽度上限。窄列时按列宽夹取，避免溢出内容区（spec 场景 5）。 */
const CARD_MAX_WIDTH_PX = 280;
const CARD_COLUMN_INSET_PX = 40;

/**
 * 内容区左边缘的竖排刻度大纲（spec `ui/transcript-outline.md`）。
 *
 * 它挂在滚动面上、内容列之外：刻度住在 800px 列左侧的留白里（对齐 Codex），
 * 而列自己 `overflow-x: clip`，住在列里的刻度一旦往左越过列的内边距就会被裁
 * 掉。因此**任何宽度下都不占用正文**；宽度不够时按 spec 场景 10 整体返回
 * null，而不是改成窄版形态。
 */
export function TranscriptOutline({
  items,
  activeId,
  visibleIds,
  columnWidth,
  columnInset,
  viewportHeight,
  onJump,
}: TranscriptOutlineProps) {
  // 记 id 而不是下标：上翻补更早一页时整列会整体下移，记下标会让涟漪与预览卡
  // 漂到隔壁一条去（spec 场景 9）。
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredIndex =
    hoveredId === null ? -1 : items.findIndex((i) => i.id === hoveredId);
  // 刻度条自身滚动：滚到哪儿了、两头是否还能再滚（决定箭头是否可用）。
  const ticksRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [atEnds, setAtEnds] = useState({ top: true, bottom: false });
  // 蒙层只在**正在翻动**时出现，停手就收回去（设计师 1110：「蒙层只有在滚动时
  // 出现，平时不出现」）。静止的刻度列不该被淡掉一截——它本来就短，头尾各淡一截
  // 会让人以为还有内容没显示。
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);
  // 自动跟随用的两个记号：她是否亲手翻过刻度条、上一轮锚点是否被「操作中」挡掉。
  const manualRailRef = useRef(false);
  const followSkippedRef = useRef(false);
  // 「正在操作刻度条」= 指针压在某条刻度上（或键盘焦点落在某条上）**或**正在翻动。
  // 操作期间只认两处高亮：跟手的悬停涟漪 + 当前这一轮；其余「在视口内」的提色要
  // 让开（设计师 1110：「现在界面在显示的对话，刻度颜色会深一些，这个是在不操作
  // 刻度条的时候，操作的时候只显示一条 hover 和选中的高亮」）。
  const operating = hoveredIndex >= 0 || isScrolling;
  const operatingRef = useRef(operating);
  operatingRef.current = operating;
  // 刻度数就几十个，逐条 `includes` 比每次渲染再建一个 Set 便宜，也不会让
  // 「父组件同一份数组」在子组件里变成新对象而反复重算。`?? []` 必须 memo：
  // 每次渲染现造一个空数组会让下面依赖它的跟随回调每帧换新，跟着把 effect 也点着。
  const visibleIdList = useMemo(() => visibleIds ?? [], [visibleIds]);

  const visible = shouldShowOutline(columnWidth, columnInset, items.length);
  // viewportHeight 为 0 = 还没测到：此时不判溢出，免得首帧闪一对箭头。
  const overflows =
    visible &&
    viewportHeight > 0 &&
    outlineRailOverflows(items.length, viewportHeight);
  const listHeight =
    viewportHeight > 0
      ? outlineRailListHeight(items.length, viewportHeight)
      : undefined;

  /**
   * 「她正在翻刻度条」：点亮上下蒙层，同时让「在视口内」的提色让位。
   *
   * 只由**她的操作**点亮（刻度条上的滚轮、上下箭头），**不**跟着 scroll 事件走：
   * 刻度条自己也会滚——见下面的自动跟随，那是消息在动、不是她在动，若也点亮，
   * 每次滚动正文都会在刻度上闪一层蒙版。
   * 停手 420ms 后熄灭：略长于一次惯性滑行的间隔，又短到不会在手指停下之后还
   * 挂着一层淡影。定时器存 ref，卸载时清掉，免得上一次会话的尾巴点亮新组件。
   */
  const markScrolling = useCallback(() => {
    setIsScrolling(true);
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      scrollTimerRef.current = null;
      setIsScrolling(false);
    }, 420);
  }, []);

  useEffect(
    () => () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    },
    [],
  );

  // 指针停在刻度条上滚轮：**只滚刻度条，界面一律不动**（设计师 1110：「鼠标在刻度
  // 这里滚动的时候，界面不要滚动」）。早先是滚到尽头就把滚动交还给消息列表，
  // 那会让一次连续的滚轮手势在末尾突然变成翻正文——读者以为还在刻度上，正文却跑
  // 了。所以这里只要刻度条还能滚就拦下（`preventDefault`），到了尽头就停住。
  // 监听挂整条（含上下箭头的格子），指针停在箭头上滚也认。
  // React 的 onWheel 是 passive 的、拦不住默认行为，只能自己挂原生监听。
  useEffect(() => {
    const zone = ticksRef.current;
    const el = listRef.current;
    if (!zone || !el || !overflows) return;
    const onWheel = (event: WheelEvent) => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      // 无条件拦：尽头再滚也拦，只是 `scrollTop` 已经顶住不动——这正是她要的
      // 「界面不要滚动」。`overscroll-behavior: contain` 在这里不够用，它挡的是
      // 链式滚动，挡不住指针不在本元素上时的默认滚动。
      event.preventDefault();
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + event.deltaY));
      manualRailRef.current = true;
      markScrolling();
    };
    zone.addEventListener("wheel", onWheel, { passive: false });
    return () => zone.removeEventListener("wheel", onWheel);
  }, [markScrolling, overflows]);

  // 刻度条被滚（她的操作或自动跟随）：同步箭头可用态（卡片位置也跟着算）。
  // 值没变就原样返回，否则「每次渲染都对一次账」会自激成死循环。
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const top = el.scrollTop <= 0;
    const bottom = el.scrollTop >= max - 1;
    setScrollTop((prev) => (prev === el.scrollTop ? prev : el.scrollTop));
    setAtEnds((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);

  // 箭头只在需要它的那一端「亮」，但两头都保留占位：否则滚动时刻度列会随着
  // 箭头出现/消失上下跳一下。翻页步长固定 20 格（见 outlineRailScrollStep）。
  const page = useCallback(
    (direction: -1 | 1) => {
      const el = listRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const step = outlineRailScrollStep();
      el.scrollTo({
        top: Math.max(0, Math.min(max, el.scrollTop + direction * step)),
        behavior: "smooth",
      });
      manualRailRef.current = true;
      markScrolling();
    },
    [markScrolling],
  );

  /**
   * 刻度条跟着消息走（设计师 1110：「让刻度条自动跟随」）。
   *
   * 刻度条有独立滚动位置、又只看得见几十格，而「当前这一轮」可能在窗外的中点——
   * 收短到 1/3 之后更明显：120 条、刻度条停在 300 时，8 条「在视口内」的刻度
   * 一条都不在可见窗里，提色等于白提。所以每次「锚点换人」（她翻正文、点刻度跳转、
   * 新消息到达让吸顶条换了），就把那条刻度**最小幅度**地挪回可见范围。
   *
   * 锚点 = 当前这一轮（`activeId`）；**会话最顶上没有「之上最近的一条」**（吸顶条
   * 为空），这时退回「视口内最靠上的那条」——否则刚翻到最顶时它就不跟了，实测
   * 那一刻 9 条提色刻度一条都不在窗里。
   *
   * 口径：
   * - **最小幅度而不是居中**：贴着边就只挪一点，刻度条才不会每次翻页都整体跳动；
   * - **留 2 格余量**（`OUTLINE_TICK_PITCH_PX * 2`）：贴着硬边时看不出上下还有没有
   *   刻度，也点不着；
   * - **她正压着/翻着刻度条时不抢**：读数走 ref，不进依赖——否则松手那一刻会把她
   *   刚翻到的地方拉回去。被跳过的这一次记在 `followSkippedRef`，等她松手再补一次；
   *   但如果她自己翻过刻度条（`manualRailRef`），就等锚点下次换人再归位。
   */
  const followRef = useRef(handleScroll);
  followRef.current = handleScroll;

  const followAnchor = useCallback(() => {
    const el = listRef.current;
    // `listHeight` 还没测到（首帧）时不跟随：那时刻度条的高度还不是最终值。
    if (!el || !overflows || !listHeight) return;
    const targetId = activeId ?? visibleIdList[0];
    if (!targetId) return;
    const index = items.findIndex((item) => item.id === targetId);
    if (index < 0) return;
    const margin = OUTLINE_TICK_PITCH_PX * 2;
    const tickTop = index * OUTLINE_TICK_PITCH_PX;
    const tickBottom = tickTop + OUTLINE_TICK_BOX_PX;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    let next = viewTop;
    if (tickTop - margin < viewTop) {
      next = tickTop - margin;
    } else if (tickBottom + margin > viewBottom) {
      next = tickBottom + margin - el.clientHeight;
    }
    if (next === viewTop) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(max, next));
    followRef.current();
  }, [activeId, items, listHeight, overflows, visibleIdList]);

  // 锚点换人：重新允许跟随，并补上之前被「操作」挡掉的那次。
  useEffect(() => {
    manualRailRef.current = false;
    if (operatingRef.current) {
      followSkippedRef.current = true;
      return;
    }
    followSkippedRef.current = false;
    followAnchor();
  }, [followAnchor]);

  // 松手后补一次：悬停期间锚点换了人时，刻度条还停在原处（实测有 1030px 的偏差）。
  // 她自己翻过刻度条的话不补——那是她要看别处。
  useEffect(() => {
    if (operating) return;
    if (!followSkippedRef.current || manualRailRef.current) return;
    followSkippedRef.current = false;
    followAnchor();
  }, [followAnchor, operating]);

  // 每次渲染后对一次账：刻度是流式到达的，「能不能往下滚」在挂载那一刻往往还
  // 不成立（那时列还没撑开），只靠 scroll 事件会一直停在「到底了」。
  useEffect(() => {
    handleScroll();
  });

  if (!visible) return null;

  const cardMaxWidth =
    columnWidth > 0
      ? Math.max(
          160,
          Math.min(CARD_MAX_WIDTH_PX, columnWidth - CARD_COLUMN_INSET_PX),
        )
      : CARD_MAX_WIDTH_PX;

  return (
    <div
      className="outline-rail"
      data-testid="transcript-outline"
      role="presentation"
    >
      <div
        className={`outline-ticks${overflows ? " outline-ticks--scroll" : ""}`}
        ref={ticksRef}
        role="navigation"
        aria-label="消息大纲"
        style={{
          // 刻度列垂直居中：上下各留 OUTLINE_VERTICAL_RESERVE_PX / 2，首/末
          // 刻度的预览卡因此不会溢出视口（见 transcriptOutline 的常量注释）。
          top: viewportHeight > 0 ? Math.round(viewportHeight / 2) : "50vh",
        }}
      >
        {overflows && (
          <button
            type="button"
            className="outline-scroll-btn outline-scroll-btn--up"
            data-testid="outline-scroll-up"
            aria-label="向上滚动消息大纲"
            disabled={atEnds.top}
            onClick={() => page(-1)}
          >
            {/* ChevronIcon 的 `expanded` 态画的是「下」；「上」用同一条矢量转 180°。 */}
            <ChevronIcon
              expanded
              size={20}
              className="outline-scroll-btn-icon outline-scroll-btn-icon--up"
            />
          </button>
        )}
        <div
          // 到端的那一侧撤掉渐隐（`--at-top` / `--at-bottom`）：蒙层只说「这一头
          // 还有没有」，滚到头就该是硬边。`is-scrolling` 才是蒙层出现的开关——
          // 停手就收回去，静止时这个盒子上没有蒙层（见 CSS 的 @property 过渡）。
          className={`outline-tick-list${isScrolling ? " is-scrolling" : ""}${
            atEnds.top ? " outline-tick-list--at-top" : ""
          }${atEnds.bottom ? " outline-tick-list--at-bottom" : ""}`}
          ref={listRef}
          data-testid="outline-tick-list"
          style={{
            // 上限 = 刻度条预算减去上下两支箭头；点内框，命中盒高度算在内。
            maxHeight: listHeight,
            // 间距固定（设计师 1110）：节距恒为 10px（短线 2 + 空白 8）。
            gap: OUTLINE_TICK_GAP_PX,
          }}
          onScroll={handleScroll}
        >
          {items.map((item, index) => {
            const active = item.id === activeId;
            // 在视口里：颜色提到悬停档（宽度不动，仍走一长一短）。但**只在没在
            // 操作刻度条时**才提——操作期间整列只该有两处高亮（悬停的那簇 + 当前
            // 这一轮），否则「我现在读到哪儿」的提示会和「哪几条在屏幕里」混成一片，
            // 看不出指针带着的是哪一条。松手后 0.42s（蒙层收起的同时）这里回到提色。
            const inView =
              !active && !operating && visibleIdList.includes(item.id);
            // hover 涟漪 + 未选中「一长一短」：宽度只写进 CSS 变量，真正画线的
            // 是 `::before`（见 CSS）。
            const distance =
              hoveredIndex < 0 ? -1 : Math.abs(index - hoveredIndex);
            const tickWidth = outlineTickWidth(distance, index);
            return (
              <button
                key={item.id}
                type="button"
                className={`outline-tick${active ? " outline-tick--active" : ""}${
                  inView ? " outline-tick--in-view" : ""
                }`}
                data-testid="outline-tick"
                data-message-id={item.id}
                aria-current={active ? "true" : undefined}
                aria-label={item.question}
                style={
                  {
                    "--outline-tick-w": `${tickWidth}px`,
                  } as React.CSSProperties
                }
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(item.id)}
                onBlur={() => setHoveredId(null)}
                onClick={() => onJump(item.id)}
              />
            );
          })}
        </div>
        {overflows && (
          <button
            type="button"
            className="outline-scroll-btn outline-scroll-btn--down"
            data-testid="outline-scroll-down"
            aria-label="向下滚动消息大纲"
            disabled={atEnds.bottom}
            onClick={() => page(1)}
          >
            <ChevronIcon
              expanded
              size={20}
              className="outline-scroll-btn-icon"
            />
          </button>
        )}
        {/* 预览卡住在可滚区外面：可滚区 `overflow-y: auto` 会把伸出盒外的卡片
            裁掉。位置按「第几条 × 节距 − 已滚动量」算（见 outlineCardTop）。 */}
        {hoveredIndex >= 0 && (
          <span
            className="outline-card"
            data-testid="outline-card"
            style={{
              maxWidth: cardMaxWidth,
              // 可滚区上面还有一格箭头时，卡片要跟着往下让那么多。
              top:
                outlineCardTop(hoveredIndex, scrollTop) +
                (overflows ? OUTLINE_RAIL_ARROW_SLOT_PX : 0),
            }}
          >
            <span className="outline-card-question">
              {items[hoveredIndex]?.question}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
