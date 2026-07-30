import { collectSpecs, collectTests } from "../.vitepress/spec-stats.mjs";

const fmt = (n) => n.toLocaleString("en-US");

export default {
  // globs starting with "." resolve relative to this file (docs/specs/)
  watch: ["./**/*.md"],
  load() {
    const { groups, totals } = collectSpecs();
    const tests = collectTests();
    return {
      stats: [
        { label: "规格文件", value: fmt(totals.specs) },
        { label: "用户故事", value: fmt(totals.us) },
        { label: "验收场景", value: fmt(totals.ac) },
        { label: "测试用例", value: fmt(tests.cases) },
      ],
      groups: groups.map(({ dir, text, specs }) => ({
        dir,
        text,
        specs: specs.map(({ path, name, description, usCount, acCount }) => ({
          path,
          name,
          description,
          usCount,
          acCount,
        })),
      })),
    };
  },
};
