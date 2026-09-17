# docs/specs 写作约定

本目录的 markdown 既是「给模型看的规格」，也是「会被 Vue 模板编译的源码」—— 它由 `docs/.vitepress/config.js` 生成 sidebar 并交给 VitePress 构建成站点页面，所以两边的要求都要满足。

- **占位符一律用反引号包裹**：markdown-it 开着 `html: true`，`<` 后跟 **ASCII 字母**（`<N>`、`<scope>`、`<name>`）会被 Vue 当成组件标签，构建直接失败：`[plugin vite:vue] docs/specs/....md (行:列): Element is missing end tag`。写 `` `「<市场名>」已更新 <N> 个插件` ``，不要写裸的 `<N>`。CJK 占位符（`<市场名>`、`<版本>`）不会触发该解析，但同样包裹以保持同文件一致。
- **报错里的 `(行:列)` 是转换后 SFC 的位置，不是源文件行号** —— 照行号找不到东西；直接在整个文件里搜 `<` 更快。
- **改了本目录的文件就跑 `pnpm run docs:build`**（仓库根，约 2 分钟，与 CI 的 `pages.yml` 同一条命令）。不要只跑 `pnpm exec vitepress build docs`：缺少 `docs/public/screenshots/` 时会以 `Rollup failed to resolve import "...webp"` 假报错。
- **这类失败在 PR 门禁里看不见**：`pages.yml`（Deploy VitePress to GitHub Pages）只在 `push: main` 且命中 `docs/**` 等 paths 时触发，`Docs Checks` 只查链接与 sidebar 锚点。所以本地那次 `docs:build` 是合并前唯一的证据。

规格结构本身（frontmatter、`## 用户场景与测试`、用户故事与验收场景写法、新增/修改后跑 spec 计数校验）见仓库根的 `AGENTS.md`；本文件只记本目录独有的坑。
