/**
 * 「扩展名 → CodeMirror 语言」表（`src/components/fileEditor/editorTheme.ts`）。
 *
 * 这张表漏一条是**静默纯文本**：不报错、不打日志，文件打开后一个字都不上色 ——
 * 客户报的 .vue 正是这一档。所以断言不只钉「返回的不是空扩展」（那对任何非空
 * 扩展都成立），而是把真解析出来的节点名拿来对：Vue 单文件组件的模板 / 脚本 /
 * 样式三层都得有各自的节点，才算真的按 SFC 解析。
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { languageFor } from "../../src/components/fileEditor/editorTheme";

const nodeNames = (path: string, doc: string): string[] => {
  const state = EditorState.create({ doc, extensions: [languageFor(path)] });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  const names = new Set<string>();
  tree?.iterate({
    enter: (node) => {
      names.add(node.name);
    },
  });
  return [...names];
};

describe("languageFor", () => {
  it("把 .vue 当单文件组件解析：模板 / <script> / <style> 三层都有节点", () => {
    const doc = [
      "<template>",
      '  <div v-if="ok">{{ msg }}</div>',
      "</template>",
      "",
      '<script setup lang="ts">',
      "const n: number = 41 + 1;",
      "</script>",
      "",
      "<style scoped>",
      ".wrap { color: #ff0000; }",
      "</style>",
      "",
    ].join("\n");
    const names = nodeNames("App.vue", doc);
    // 模板层：插值、Vue 指令各有一条真规则（纯文本 / 无语言时一个都不会有）。
    expect(names).toContain("Interpolation");
    expect(names).toContain("VueAttributeName");
    // <script setup lang="ts">：类型注解说明区块里跑的是 TS 解析器。
    expect(names).toContain("TypeAnnotation");
    // <style>：样式表解析器接手。
    expect(names).toContain("StyleSheet");
  });

  it("表里没有的扩展名仍然回退纯文本", () => {
    expect(languageFor("thing.waveunknown")).toEqual([]);
    expect(nodeNames("thing.waveunknown", "const a = 1;")).toEqual([]);
  });
});
