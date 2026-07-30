#!/usr/bin/env node
// 校验 spec 模板并打印统计。docs/specs/index.md 的表格由 VitePress 构建时
// 通过 docs/specs/specs.data.js 动态生成，此脚本不再修改任何文件。
import { collectSpecs, collectTests } from "../docs/.vitepress/spec-stats.mjs";

const { groups, totals, warnings } = collectSpecs();

for (const group of groups) {
  for (const s of group.specs) {
    console.log(`${s.path}  用户故事: ${s.usCount}  功能需求: ${s.frCount}`);
  }
}
for (const w of warnings) console.warn(`  ⚠ ${w}`);

console.log("---");
console.log(`规格: ${totals.specs}  用户故事: ${totals.us}  功能需求: ${totals.fr}`);
if (warnings.length) console.warn("⚠ 部分规格有模板警告——见上方。");

const tests = collectTests();
console.log(`测试文件: ${tests.files}  测试用例: ${tests.cases.toLocaleString()}`);
