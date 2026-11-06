import { describe, expect, it } from "vitest";
import {
  anchorAt,
  buildRowMetrics,
  compensationFor,
  offsetForAnchor,
  rangeFor,
  rowAtOffset,
} from "../../src/virtual/geometry";

const sizesOf = (sizes: number[]) => (_key: string, index: number) =>
  sizes[index];

function metrics(sizes: number[]) {
  return buildRowMetrics(
    sizes.map((_, index) => `m${index}`),
    sizesOf(sizes),
  );
}

describe("buildRowMetrics", () => {
  it("前缀和与总高", () => {
    const m = metrics([40, 60, 100]);
    expect(m.offsets).toEqual([0, 40, 100, 200]);
    expect(m.total).toBe(200);
  });

  it("负数尺寸按 0 处理，不把后面的行推上去", () => {
    const m = metrics([40, -10, 20]);
    expect(m.offsets).toEqual([0, 40, 40, 60]);
  });
});

describe("rowAtOffset", () => {
  const m = metrics([40, 60, 100]);

  it("空列表返回 -1", () => {
    expect(rowAtOffset(metrics([]), 0)).toBe(-1);
  });

  it("行首边界归下一行，行尾归本行", () => {
    expect(rowAtOffset(m, 0)).toBe(0);
    expect(rowAtOffset(m, 39)).toBe(0);
    expect(rowAtOffset(m, 40)).toBe(1);
    expect(rowAtOffset(m, 99)).toBe(1);
    expect(rowAtOffset(m, 100)).toBe(2);
  });

  it("越界夹到首行/末行", () => {
    expect(rowAtOffset(m, -50)).toBe(0);
    expect(rowAtOffset(m, 10_000)).toBe(2);
  });
});

describe("rangeFor", () => {
  // 20 行 × 100px = 2000px。
  const m = metrics(new Array(20).fill(100));
  const base = { viewport: 400, overscanTop: 600, overscanBottom: 600 };

  it("空列表返回空区间", () => {
    expect(rangeFor(metrics([]), 0, base)).toEqual({ start: -1, end: -1 });
  });

  it("缓冲按像素算，不按行数", () => {
    // 视口 [0,400) 覆盖 1-4 行；往上 600px 没有更多行，往下再 600px 到第 10 行。
    const r = rangeFor(m, 0, { ...base, nearTailScreens: 0 });
    expect(r.start).toBe(0);
    expect(r.end).toBe(9);
  });

  it("行矮时同样的像素预算覆盖更多行", () => {
    const short = metrics(new Array(200).fill(20));
    const r = rangeFor(short, 2000, {
      viewport: 400,
      overscanTop: 600,
      overscanBottom: 600,
      nearTailScreens: 0,
    });
    // 视口 [2000,2400) = 第 100-119 行；上下各再扩 30 行。
    expect(r.start).toBe(70);
    expect(r.end).toBe(149);
  });

  it("离末尾不足两屏就整段渲染到末尾", () => {
    // 滚到 1200：距末尾 2000-1600=400px，正好一屏，落在两屏之内。
    const r = rangeFor(m, 1200, { ...base, nearTailScreens: 2 });
    expect(r.end).toBe(19);
    // 顶部同样：1600 处离内容顶两屏（800px）以内，整段渲染到 0。
    expect(r.start).toBe(0);
  });

  it("远离两端时两屏折叠不生效", () => {
    const tail = metrics(new Array(200).fill(100));
    const r = rangeFor(tail, 10_000, { ...base, nearTailScreens: 2 });
    expect(r.start).toBe(94);
    expect(r.end).toBe(109);
  });
});

describe("锚点", () => {
  const before = buildRowMetrics(
    ["a", "b", "c"],
    (_k, i) => [100, 100, 100][i],
  );

  it("锚点带行内偏移", () => {
    expect(anchorAt(before, 150)).toEqual({ key: "b", offsetInItem: 50 });
  });

  describe("视口顶那一行还没量过", () => {
    // 上翻一页插进顶部之后，视口顶落在新一页最后一行身上，而它必然还没进账本。
    const m = buildRowMetrics(
      ["z0", "z1", "n0", "n1"],
      (_k, i) => [50, 50, 72, 72][i],
    );
    const measuredOnly = (measured: string[]) => (key: string) =>
      measured.includes(key);

    it("锚点让给视口里第一行量过的行（用它的起点）", () => {
      // 视口顶在 60 —— z1 里（未测量，估算 50）。让给 n0 的起点 100。
      expect(
        anchorAt(m, 60, {
          isMeasured: measuredOnly(["n0", "n1"]),
          viewport: 400,
        }),
      ).toEqual({ key: "n0", offsetInItem: -40 });
    });

    it("量过的行只在视口范围内找", () => {
      // 视口只有 20px 高，n0 的起点 100 已在视口外 ⇒ 退回原来那一行。
      expect(
        anchorAt(m, 60, {
          isMeasured: measuredOnly(["n0", "n1"]),
          viewport: 20,
        }),
      ).toEqual({ key: "z1", offsetInItem: 10 });
    });

    it("视口里一行都没量过（首屏刚挂载）：照旧按行内偏移", () => {
      expect(
        anchorAt(m, 60, { isMeasured: measuredOnly([]), viewport: 400 }),
      ).toEqual({ key: "z1", offsetInItem: 10 });
    });

    it("补偿算的是量过那一行的起点：它自己的高度变化不算，上面的算", () => {
      // z1 量出真实高度 900（估算只有 50），n0 的起点因此从 100 挪到 950。
      const after = buildRowMetrics(
        ["z0", "z1", "n0", "n1"],
        (_k, i) => [50, 900, 72, 72][i],
      );
      const anchor = anchorAt(m, 60, {
        isMeasured: measuredOnly(["n0", "n1"]),
        viewport: 400,
      })!;
      expect(compensationFor(m, after, anchor)).toBe(850);
    });
  });

  it("上面插进一行：补偿量正好是插进来的高度", () => {
    const after = buildRowMetrics(
      ["x", "y", "a", "b", "c"],
      (_k, i) => [100, 100, 100, 100, 100][i],
    );
    const anchor = anchorAt(before, 150)!;
    expect(compensationFor(before, after, anchor)).toBe(200);
  });

  it("锚点行长高了：视口不动（增量在锚点下方）", () => {
    const after = buildRowMetrics(
      ["a", "b", "c"],
      (_k, i) => [100, 260, 100][i],
    );
    const anchor = anchorAt(before, 50)!;
    expect(compensationFor(before, after, anchor)).toBe(0);
  });

  it("锚点上方的行缩了：视口跟着回退", () => {
    const after = buildRowMetrics(
      ["a", "b", "c"],
      (_k, i) => [40, 100, 100][i],
    );
    const anchor = anchorAt(before, 150)!;
    expect(compensationFor(before, after, anchor)).toBe(-60);
  });

  it("锚点行没了返回 undefined（rewind 截断）", () => {
    const after = buildRowMetrics(["c"], () => 100);
    const anchor = anchorAt(before, 150)!;
    expect(compensationFor(before, after, anchor)).toBeUndefined();
  });

  it("offsetForAnchor 在新账本里找位置", () => {
    const after = buildRowMetrics(["x", "a", "b", "c"], () => 100);
    expect(offsetForAnchor(after, { key: "b", offsetInItem: 50 })).toBe(250);
  });
});
