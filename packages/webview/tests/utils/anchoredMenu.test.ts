import { describe, expect, it } from "vitest";
import {
  MENU_ANCHOR_GAP,
  MENU_VIEWPORT_MARGIN,
  SELECT_MENU_ANCHOR_GAP,
  placeAnchoredMenu,
} from "../../src/utils/anchoredMenu";

// 锚定菜单的落点规则（spec docs/specs/desktop/desktop-sessions.md「会话行菜单
// 完整可见」）：下方放得下就向下，放不下整个翻到上方，上下都放不下才夹在视口内
// 并内部滚动。这里只算几何，真实渲染另见 e2e/desktop-sidebar-row-menu。

const VIEWPORT = { width: 1200, height: 800 };
const MENU = { width: 148, height: 102 };

/** 造一个触发器矩形：右上角对齐侧栏行右端，纵向位置可调。 */
const anchorAt = (top: number, height = 30) => ({
  top,
  bottom: top + height,
  left: 12,
  right: 247,
});

describe("placeAnchoredMenu", () => {
  it("下方放得下时向下展开", () => {
    const anchor = anchorAt(300);
    const placement = placeAnchoredMenu(anchor, MENU, VIEWPORT);
    expect(placement.top).toBe(anchor.bottom + MENU_ANCHOR_GAP);
    expect(placement.maxHeight).toBeUndefined();
  });

  it("下方放不下、上方放得下时整个翻到行上方（底边贴行顶 − 缝隙）", () => {
    // 会话列表滚到底时的那一行：bottom = 740，下方只剩 56px，菜单要 102px
    const anchor = anchorAt(710);
    expect(VIEWPORT.height - anchor.bottom - MENU_ANCHOR_GAP).toBeLessThan(
      MENU.height,
    );

    const placement = placeAnchoredMenu(anchor, MENU, VIEWPORT);
    expect(placement.top).toBe(anchor.top - MENU_ANCHOR_GAP - MENU.height);
    // 整块菜单落在视口内，且不盖住触发它的那一行
    expect(placement.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN);
    expect(placement.top + MENU.height).toBe(anchor.top - MENU_ANCHOR_GAP);
    expect(placement.maxHeight).toBeUndefined();
  });

  it("上下都放不下时取空间大的一侧并限制高度（菜单内部滚动）", () => {
    // 窗口只有 120px 高，行贴着顶部：上方只剩 8px，下方也不够 102px
    const viewport = { width: 1200, height: 120 };
    const anchor = anchorAt(20);

    const below = placeAnchoredMenu(anchor, MENU, viewport);
    const spaceBelow =
      viewport.height - anchor.bottom - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
    const spaceAbove = anchor.top - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
    expect(spaceBelow).toBeGreaterThan(spaceAbove);
    expect(below.top).toBe(anchor.bottom + MENU_ANCHOR_GAP);
    expect(below.maxHeight).toBe(spaceBelow);
    // 夹取后菜单底缘仍在视口内（留白以内）
    expect(below.top + (below.maxHeight ?? 0)).toBeLessThanOrEqual(
      viewport.height - MENU_VIEWPORT_MARGIN,
    );
  });

  it("上方空间更大时贴着视口顶留白夹取", () => {
    const viewport = { width: 1200, height: 130 };
    const anchor = anchorAt(100);

    const placement = placeAnchoredMenu(anchor, MENU, viewport);
    const spaceAbove = anchor.top - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
    expect(spaceAbove).toBeGreaterThan(
      viewport.height - anchor.bottom - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN,
    );
    expect(placement.top).toBe(MENU_VIEWPORT_MARGIN);
    expect(placement.maxHeight).toBe(spaceAbove);
    // 底边不越过行顶（不压住触发按钮）
    expect(placement.top + (placement.maxHeight ?? 0)).toBeLessThanOrEqual(
      anchor.top - MENU_ANCHOR_GAP,
    );
  });

  it("还没量到高度（height = 0）时保持向下展开", () => {
    const anchor = anchorAt(710);
    const placement = placeAnchoredMenu(
      anchor,
      { ...MENU, height: 0 },
      VIEWPORT,
    );
    expect(placement.top).toBe(anchor.bottom + MENU_ANCHOR_GAP);
    expect(placement.maxHeight).toBeUndefined();
  });

  // 下拉选择器族（设置页 SettingsSelect / 会话看板项目筛选）用 2px 缝隙，
  // 与菜单族的 4px 不同；其余摆放规则（下 → 翻上 → 夹取）完全共用。
  it("缝隙可由调用方按族传入：选择器族向下贴 +2、翻上贴 −2", () => {
    const gap = SELECT_MENU_ANCHOR_GAP;
    expect(gap).toBe(2);

    expect(
      placeAnchoredMenu(anchorAt(300), MENU, VIEWPORT, "right", gap).top,
    ).toBe(anchorAt(300).bottom + gap);

    const low = anchorAt(710);
    const flipped = placeAnchoredMenu(low, MENU, VIEWPORT, "right", gap);
    expect(flipped.top).toBe(low.top - gap - MENU.height);
    expect(flipped.maxHeight).toBeUndefined();

    // 夹取分支的可用高度也要按传入的缝隙算
    const cramped = placeAnchoredMenu(
      anchorAt(20, 30),
      { ...MENU, height: VIEWPORT.height },
      VIEWPORT,
      "right",
      gap,
    );
    expect(cramped.maxHeight).toBe(
      VIEWPORT.height - anchorAt(20, 30).bottom - gap - MENU_VIEWPORT_MARGIN,
    );
  });

  it("水平方向默认右对齐锚点，并夹在视口留白内", () => {
    const anchor = { top: 300, bottom: 330, left: 12, right: 247 };
    expect(placeAnchoredMenu(anchor, MENU, VIEWPORT).left).toBe(
      anchor.right - MENU.width,
    );

    // 贴右缘：右对齐会让菜单越界时向左夹到留白处
    const rightAnchor = { top: 300, bottom: 330, left: 1000, right: 1195 };
    expect(placeAnchoredMenu(rightAnchor, MENU, VIEWPORT).left).toBe(
      VIEWPORT.width - MENU.width - MENU_VIEWPORT_MARGIN,
    );

    // 左对齐（创作集操作列）：与锚点左缘同 x，贴右缘时再向左夹进视口
    expect(placeAnchoredMenu(rightAnchor, MENU, VIEWPORT, "left").left).toBe(
      rightAnchor.left,
    );
    expect(
      placeAnchoredMenu(
        { ...rightAnchor, left: 1100, right: 1140 },
        MENU,
        VIEWPORT,
        "left",
      ).left,
    ).toBe(VIEWPORT.width - MENU.width - MENU_VIEWPORT_MARGIN);
    expect(placeAnchoredMenu(anchor, MENU, VIEWPORT, "left").left).toBe(
      anchor.left,
    );
  });
});
