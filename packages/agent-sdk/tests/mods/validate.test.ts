import { describe, expect, it } from "vitest";
import { validateModTree } from "../../src/mods/validate.js";
import { MOD_LIMITS, type ModTreeNode } from "../../src/types/mods.js";

/**
 * 校验器是「mod 返回值离开沙箱之后、进 RPC 之前」的唯一闸门（spec
 * `ecosystem/plugin-mods.md`「限额」）：形状不合或超限就整棵树不画，并给出
 * 一条能指到具体原因的错误摘要。
 */

function text(value: string): ModTreeNode {
  return { type: "Text", props: {}, children: [value] };
}

function box(...children: Array<ModTreeNode | string>): ModTreeNode {
  return { type: "Box", props: {}, children };
}

/** 套 `depth` 层 Box，最里层是一片文本 —— 总深度 = depth + 1。 */
function nested(depth: number): ModTreeNode {
  let node = text("x");
  for (let i = 0; i < depth - 1; i++) node = box(node);
  return node;
}

describe("validateModTree", () => {
  it("接受合法树，并返回只保留已知字段的副本", () => {
    const input = {
      type: "Box",
      props: { gap: 2, flexShrink: 0 },
      children: [text("hi")],
      // 宿主只认 type/props/children，其余字段不往下游传。
      extra: "dropped",
    };

    const result = validateModTree(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree).toEqual({
      type: "Box",
      props: { gap: 2, flexShrink: 0 },
      children: [{ type: "Text", props: {}, children: ["hi"] }],
    });
    expect(result.tree).not.toHaveProperty("extra");
  });

  describe("prop 白名单", () => {
    it("拒绝拼错的 prop，并点名它和该元素的可用名单", () => {
      const result = validateModTree({
        type: "Button",
        props: { key: "b1", label2: "x" },
        children: [],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // 静默忽略会让作者以为写对了：错误必须点出元素 + prop 名。
      expect(result.error).toContain("Button");
      expect(result.error).toContain("label2");
    });

    it("别的框架的习惯写法（className / style）也当场报错", () => {
      for (const props of [{ className: "x" }, { style: "color: red" }]) {
        const result = validateModTree({ type: "Text", props, children: [] });
        expect(result.ok).toBe(false);
      }
    });

    it("key 每个元素都能带（列表里的稳定标识）", () => {
      expect(
        validateModTree({
          type: "Box",
          props: { key: "row-1" },
          children: [text("hi")],
        }).ok,
      ).toBe(true);
    });

    it("Button.variant 只认 primary / secondary", () => {
      const variant = (value: unknown) =>
        validateModTree({
          type: "Button",
          props: { key: "b1", variant: value },
          children: [],
        });

      expect(variant("primary").ok).toBe(true);
      expect(variant("secondary").ok).toBe(true);
      expect(variant("danger").ok).toBe(false);
    });

    it("Button.hotkey 是一个数字或一个小写字母", () => {
      const hotkey = (value: unknown) =>
        validateModTree({
          type: "Button",
          props: { key: "b1", hotkey: value },
          children: [],
        });

      expect(hotkey("a").ok).toBe(true);
      expect(hotkey("7").ok).toBe(true);
      // 大写不认：CC 的口径是小写字母 + 数字，且不区分大小写地撞键会让人猜不透。
      for (const value of ["A", "ab", "", "Enter", 1]) {
        const result = hotkey(value);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error).toContain("hotkey");
      }
    });
  });

  describe("视觉与布局的 prop（spec「元素」）", () => {
    it("整批新 prop 都能过", () => {
      const result = validateModTree({
        type: "Box",
        props: {
          key: "row",
          paddingX: "sm",
          paddingY: 2,
          marginX: 4,
          minHeight: 24,
          minWidth: 0,
          borderStyle: "round",
          borderColor: "promptBorder",
          backgroundColor: "#f5f5f5",
          alignSelf: "center",
          display: "flex",
          position: "absolute",
          top: 4,
          justifyContent: "space-between",
        },
        children: [
          {
            type: "Text",
            props: {
              weight: "semibold",
              size: "footnote",
              backgroundColor: "success",
              strikethrough: true,
              inverse: true,
            },
            children: ["已完成"],
          },
          {
            type: "Button",
            props: {
              key: "b1",
              label: "开",
              plain: true,
              dimColor: true,
              autoFocus: true,
            },
            children: [],
          },
          {
            type: "Input",
            props: { key: "i1", rows: 3, autoFocus: true },
            children: [],
          },
          {
            type: "Code",
            props: { source: "a\nb", wrap: "truncate-end" },
            children: [],
          },
        ],
      });

      expect(result.ok).toBe(true);
    });

    it("枚举取值写错时点名元素和可用值", () => {
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ["Box", { alignSelf: "middle" }, "alignSelf"],
        ["Box", { display: "block" }, "display"],
        ["Box", { position: "fixed" }, "position"],
        ["Text", { size: "huge" }, "size"],
        ["Text", { weight: "black" }, "weight"],
        ["Code", { source: "x", wrap: "wrap-all" }, "wrap"],
      ];
      for (const [type, props, name] of cases) {
        const result = validateModTree({ type, props, children: [] });
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error).toContain(`${type}.${name}`);
      }
    });

    it("布尔 / 数字取值写错时也当场报错", () => {
      const boolean = validateModTree({
        type: "Button",
        props: { key: "b1", plain: "yes" },
        children: [],
      });
      expect(boolean.ok).toBe(false);
      if (!boolean.ok) expect(boolean.error).toContain("Button.plain");

      const offset = validateModTree({
        type: "Box",
        props: { position: "absolute", top: "4px" },
        children: [],
      });
      expect(offset.ok).toBe(false);
      if (!offset.ok) expect(offset.error).toContain("Box.top");

      const rows = validateModTree({
        type: "Input",
        props: { key: "i1", rows: 0 },
        children: [],
      });
      expect(rows.ok).toBe(false);
      if (!rows.ok) expect(rows.error).toContain("Input.rows");
    });
  });

  describe("hover（悬停态）", () => {
    const box = (props: Record<string, unknown>, children: unknown[] = []) =>
      validateModTree({ type: "Box", props, children });

    it("是节点的独立字段，规范化后留在树上", () => {
      const result = validateModTree({
        type: "Box",
        props: { key: "row" },
        hover: { backgroundColor: "success", borderDimColor: true },
        children: [
          {
            type: "Text",
            props: {},
            hover: { color: "error", bold: true },
            children: ["x"],
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.tree.hover).toEqual({
        backgroundColor: "success",
        borderDimColor: true,
      });
      const child = result.tree.children[0] as ModTreeNode;
      expect(child.hover).toEqual({ color: "error", bold: true });
    });

    it("作用域继承最近的带 key 的 Box；没有 scope 时报错", () => {
      // 带 key 的 Box 是作用域宿主，子节点的 hover 才有地方挂。
      expect(
        box({ key: "row" }, [
          {
            type: "Text",
            props: {},
            hover: { color: "success" },
            children: ["x"],
          },
        ]).ok,
      ).toBe(true);
      // 裸 hover 无处挂：树顶就一个 Text，没有 scope。
      const loose = validateModTree({
        type: "Text",
        props: {},
        hover: { color: "error" },
        children: ["x"],
      });
      expect(loose.ok).toBe(false);
      if (!loose.ok) expect(loose.error).toContain("scope");
    });

    it("hover.scope 显式指定作用域名时不用祖先 key", () => {
      expect(
        box({}, [
          {
            type: "Text",
            props: {},
            hover: { scope: "row", color: "success" },
            children: ["x"],
          },
        ]).ok,
      ).toBe(true);
      expect(
        box({}, [
          { type: "Text", props: {}, hover: { scope: "" }, children: ["x"] },
        ]).ok,
      ).toBe(false);
    });

    it("key 集按元素封闭：hover 里写不相干的 prop 就报错", () => {
      const width = box({}, [
        {
          type: "Text",
          props: {},
          hover: { scope: "r", width: 10 },
          children: ["x"],
        },
      ]);
      expect(width.ok).toBe(false);
      if (!width.ok) expect(width.error).toContain("width");

      const border = box({}, [
        {
          type: "Text",
          props: {},
          hover: { scope: "r", borderColor: "error" },
          children: ["x"],
        },
      ]);
      expect(border.ok).toBe(false);
    });

    it("没有悬停态的元素上写 hover 就报错", () => {
      const result = validateModTree({
        type: "Input",
        props: { key: "i1" },
        hover: { dimColor: true },
        children: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("不支持 hover");
    });

    it("hover 的取值也查：颜色是字符串、布尔键是布尔、偏移是数字", () => {
      const color = box({ key: "row" }, [
        { type: "Text", props: {}, hover: { color: 1 }, children: ["x"] },
      ]);
      expect(color.ok).toBe(false);

      const boolean = box({ key: "row", hover: { borderDimColor: "yes" } });
      expect(boolean.ok).toBe(false);

      const offset = box({ key: "row", hover: { top: "4px" } });
      expect(offset.ok).toBe(false);

      const display = box({ key: "row", hover: { display: "none" } });
      expect(display.ok).toBe(false);
    });
  });

  it("根节点是裸文本时包成一个 Text", () => {
    const result = validateModTree("hello");

    expect(result.ok && result.tree).toEqual({
      type: "Text",
      props: {},
      children: ["hello"],
    });
  });

  it("拒绝未知元素类型", () => {
    const result = validateModTree({ type: "Table", props: {}, children: [] });

    expect(result).toEqual({ ok: false, error: "未知元素类型：Table" });
  });

  it("拒绝不可序列化的 prop", () => {
    const result = validateModTree({
      type: "Text",
      props: { onClick: () => undefined },
      children: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("不是可序列化的原始值");
  });

  it("拒绝 props 是数组 / children 不是数组", () => {
    expect(validateModTree({ type: "Text", props: [], children: [] }).ok).toBe(
      false,
    );
    expect(validateModTree({ type: "Text", props: {}, children: "x" }).ok).toBe(
      false,
    );
  });

  describe("Link.href 白名单", () => {
    const link = (href: unknown) =>
      validateModTree({ type: "Link", props: { href }, children: [] });

    it.each([
      "https://example.com/docs",
      "http://localhost:5173/x",
      "http://127.0.0.1:8080",
      "http://[::1]:3000",
    ])("放行 %s", (href) => {
      expect(link(href).ok).toBe(true);
    });

    it.each([
      "http://example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
    ])("拒绝 %s", (href) => {
      expect(link(href).ok).toBe(false);
    });

    it("拒绝超过 2048 字符的 href", () => {
      const href = `https://example.com/${"a".repeat(MOD_LIMITS.hrefChars)}`;
      expect(link(href).ok).toBe(false);
    });
  });

  it("Button / Input 必须带字符串 key", () => {
    expect(
      validateModTree({ type: "Button", props: { label: "x" }, children: [] })
        .ok,
    ).toBe(false);
    expect(
      validateModTree({ type: "Button", props: { key: "b1" }, children: [] })
        .ok,
    ).toBe(true);
    expect(
      validateModTree({ type: "Input", props: { key: 1 }, children: [] }).ok,
    ).toBe(false);
    expect(
      validateModTree({ type: "Input", props: { key: "i1" }, children: [] }).ok,
    ).toBe(true);
  });

  describe("Select / Svg / Progress（二期元素，prop 有白名单）", () => {
    const select = (props: Record<string, unknown>, children: unknown[] = []) =>
      validateModTree({ type: "Select", props, children });
    const svg = (props: Record<string, unknown>, children: unknown[] = []) =>
      validateModTree({ type: "Svg", props, children });
    const progress = (
      props: Record<string, unknown>,
      children: unknown[] = [],
    ) => validateModTree({ type: "Progress", props, children });

    it("Select 接受 { value, label? } 列表，并保留原样", () => {
      const options = [{ value: "a", label: "A" }, { value: "b" }];
      const result = select({ key: "s1", options, value: "a" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.tree.props).toEqual({ key: "s1", options, value: "a" });
    });

    it.each([
      [{ options: [{ value: "a" }] }, "非空的字符串 key"],
      [{ key: "s1" }, "需要 options"],
      [{ key: "s1", options: [] }, "需要 options"],
      [{ key: "s1", options: [{ value: "a" }, { value: "a" }] }, "重复"],
      [{ key: "s1", options: [{ value: 1 }] }, "value 是字符串"],
      [{ key: "s1", options: [{ value: "a", extra: 1 }] }, "{ value, label? }"],
      [{ key: "s1", options: ["a"] }, "{ value, label? }"],
      [{ key: "s1", options: [{ value: "a" }], value: 2 }, "value 是字符串"],
      [{ key: "s1", options: [{ value: "a" }], onSelect: "x" }, "上没有 prop"],
    ])("Select 拒绝 %j", (props, message) => {
      const result = select(props);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(message);
    });

    it("Select 的 options 最多 64 项", () => {
      const options = Array.from(
        { length: MOD_LIMITS.selectOptions },
        (_, i) => ({
          value: String(i),
        }),
      );
      expect(select({ key: "s1", options }).ok).toBe(true);
      expect(
        select({ key: "s1", options: [...options, { value: "over" }] }).ok,
      ).toBe(false);
    });

    it("Svg 接受 source + alt + 尺寸", () => {
      const result = svg({
        source: "<svg viewBox='0 0 1 1' />",
        alt: "折线",
        width: 120,
        height: 40,
        isInteractive: false,
      });

      expect(result.ok).toBe(true);
    });

    it.each([
      [{ alt: "x" }, "需要 source"],
      [{ source: "", alt: "x" }, "需要 source"],
      [{ source: "<svg />" }, "需要 alt"],
      [{ source: "<svg />", alt: "x", width: 0 }, "width / height"],
      [{ source: "<svg />", alt: "x", height: 10_000 }, "width / height"],
      [{ source: "<svg />", alt: "x", fill: "#000" }, "上没有 prop"],
    ])("Svg 拒绝 %j", (props, message) => {
      const result = svg(props);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(message);
    });

    it("Svg.source 超过 131072 字符就拒绝", () => {
      const source = "a".repeat(MOD_LIMITS.svgSourceChars + 1);
      const result = svg({ source, alt: "x" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("上限");
    });

    it("Progress 接受 label / value / max / valueText / color", () => {
      const result = progress({
        label: "构建",
        value: 3,
        max: 5,
        valueText: "3/5",
        color: "#4c8",
      });

      expect(result.ok).toBe(true);
    });

    it.each([
      [{}, "需要 label"],
      [{ label: "  " }, "需要 label"],
      [{ label: "构建", value: "3" }, "是数字"],
      [{ label: "构建", max: null }, "是数字"],
      [{ label: "构建", percent: 30 }, "上没有 prop"],
    ])("Progress 拒绝 %j", (props, message) => {
      const result = progress(props);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(message);
    });

    it("三个元素都是叶子，带 children 就拒绝", () => {
      const cases = [
        ["Select", { key: "s1", options: [{ value: "a" }] }],
        ["Svg", { source: "<svg />", alt: "x" }],
        ["Progress", { label: "构建" }],
      ] as const;
      for (const [type, props] of cases) {
        const result = validateModTree({
          type,
          props,
          children: [text("x")],
        });
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error).toContain("叶子元素");
      }
    });
  });

  it("按节点数上限（含根节点）拦截", () => {
    const atLimit = box(
      ...Array.from({ length: MOD_LIMITS.treeNodes - 1 }, (_, i) =>
        text(`${i}`),
      ),
    );
    expect(validateModTree(atLimit).ok).toBe(true);

    const overLimit = box(
      ...Array.from({ length: MOD_LIMITS.treeNodes }, (_, i) => text(`${i}`)),
    );
    const result = validateModTree(overLimit);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("节点数超过");
  });

  it("按深度上限拦截", () => {
    expect(validateModTree(nested(MOD_LIMITS.treeDepth)).ok).toBe(true);

    const result = validateModTree(nested(MOD_LIMITS.treeDepth + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("深度超过");
  });

  it("按树内文本总量拦截", () => {
    expect(validateModTree(text("a".repeat(MOD_LIMITS.treeTextChars))).ok).toBe(
      true,
    );

    const result = validateModTree(
      text("a".repeat(MOD_LIMITS.treeTextChars + 1)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("文本超过");
  });
});
