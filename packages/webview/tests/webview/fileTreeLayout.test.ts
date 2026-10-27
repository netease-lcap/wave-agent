import { describe, it, expect } from "vitest";
import {
  CONTENT_MIN_WIDTH,
  TREE_AUTO_HIDE_BELOW,
  TREE_COLLAPSE_BELOW,
  TREE_MAX_WIDTH,
  TREE_MIN_WIDTH,
  clampTreeWidth,
  draggedTooNarrow,
  shouldShowTree,
  treeDeferredForSpace,
  treeFits,
  treeWidthCeiling,
} from "../../src/utils/fileTreeLayout";

/**
 * 树列几何规则（spec desktop-file-panel.md「文件面板工作区目录树」场景 1-3）。
 *
 * 这些是纯函数，所以边界值直接断言；接进 FilePane 之后的表现（树真的消失、
 * 开关真的变不可用）在 `filePaneTreeLayout.test.tsx` 里驱动 DOM 验证。
 */

describe("树宽夹取（场景 2）", () => {
  it("宽度未知（还没量到面板）时只夹 MIN/MAX，不按面板 0 宽把树压没", () => {
    expect(clampTreeWidth(1000, 0)).toBe(TREE_MAX_WIDTH);
    expect(clampTreeWidth(10, 0)).toBe(TREE_MIN_WIDTH);
    expect(clampTreeWidth(200, 0)).toBe(200);
  });

  it("正常宽度下按 MIN/MAX 夹", () => {
    expect(clampTreeWidth(10, 900)).toBe(TREE_MIN_WIDTH);
    expect(clampTreeWidth(1000, 900)).toBe(TREE_MAX_WIDTH);
    expect(clampTreeWidth(260, 900)).toBe(260);
  });

  it("面板变窄时以「正文保底」为上限，而不是 MAX", () => {
    // 500 - 160 = 340，比 MAX(420) 更紧
    expect(treeWidthCeiling(500)).toBe(500 - CONTENT_MIN_WIDTH);
    expect(clampTreeWidth(420, 500)).toBe(340);
    // 面板只比保底宽一点：树被压到 MIN 以下也要让给正文
    expect(clampTreeWidth(420, 200)).toBe(40);
    expect(clampTreeWidth(420, 100)).toBe(0);
  });
});

describe("并排余地（场景 3）", () => {
  it("以 400px 为界，宽度未知时当成放得下", () => {
    expect(treeFits(0)).toBe(true);
    expect(treeFits(TREE_AUTO_HIDE_BELOW - 1)).toBe(false);
    expect(treeFits(TREE_AUTO_HIDE_BELOW)).toBe(true);
    expect(treeFits(1200)).toBe(true);
  });

  it("用户关掉树时怎么都显示不出来", () => {
    const base = { hasTree: true, available: 1200, hasOpenFile: true };
    expect(shouldShowTree({ ...base, wantsTree: false })).toBe(false);
    expect(treeDeferredForSpace({ ...base, wantsTree: false })).toBe(false);
  });

  it("没有树可放（宿主没给根）时不显示也不提示「让位」", () => {
    const base = { hasTree: false, wantsTree: true, available: 1200 };
    expect(shouldShowTree({ ...base, hasOpenFile: true })).toBe(false);
    expect(treeDeferredForSpace({ ...base, hasOpenFile: true })).toBe(false);
  });

  it("有打开文件且面板太窄：让位，并标记成「想要但放不下」", () => {
    const input = {
      hasTree: true,
      wantsTree: true,
      available: 380,
      hasOpenFile: true,
    };
    expect(shouldShowTree(input)).toBe(false);
    expect(treeDeferredForSpace(input)).toBe(true);
  });

  it("一个文件都没打开时树就是主界面，窄也让给它", () => {
    const input = {
      hasTree: true,
      wantsTree: true,
      available: 200,
      hasOpenFile: false,
    };
    expect(shouldShowTree(input)).toBe(true);
    expect(treeDeferredForSpace(input)).toBe(false);
  });

  it("面板变宽跨回 400px 时树自己回来（用户开关没被改写）", () => {
    const base = { hasTree: true, wantsTree: true, hasOpenFile: true };
    expect(shouldShowTree({ ...base, available: 399 })).toBe(false);
    expect(shouldShowTree({ ...base, available: 401 })).toBe(true);
  });
});

describe("拖到一半即收起（场景 1）", () => {
  it("以 80px 为界", () => {
    expect(draggedTooNarrow(TREE_COLLAPSE_BELOW - 1)).toBe(true);
    expect(draggedTooNarrow(TREE_COLLAPSE_BELOW)).toBe(false);
    expect(draggedTooNarrow(200)).toBe(false);
  });
});
