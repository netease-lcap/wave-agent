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
      props: { gap: 2, justify: "center" },
      children: [text("hi")],
      // 宿主只认 type/props/children，其余字段不往下游传。
      extra: "dropped",
    };

    const result = validateModTree(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree).toEqual({
      type: "Box",
      // props 不做白名单：渲染器按名字取自己认识的那些。
      props: { gap: 2, justify: "center" },
      children: [{ type: "Text", props: {}, children: ["hi"] }],
    });
    expect(result.tree).not.toHaveProperty("extra");
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
