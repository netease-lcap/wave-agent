import fs from "node:fs";
import path from "node:path";
import llmstxt from "vitepress-plugin-llms";
import { SPECS_DIR, specTitle, collectSpecs } from "./spec-stats.mjs";

// GitHub Pages（pages.yml）把站点挂在 `/wave-agent/` 下，运维平台的文档包挂在
// `/docs/` 下（scripts/pack-docs.mjs 传 DOCS_BASE）。
const siteBase = process.env.DOCS_BASE || "/wave-agent/";

const nav = [
  { text: "产品概览", link: "/" },
  { text: "教程&最佳实践", link: "/tutorials/" },
  { text: "桌面端", link: "/desktop/" },
  { text: "VSCode/JetBrains插件", link: "/vsce/" },
  { text: "Web 端", link: "/web" },
  { text: "CLI", link: "/cli/" },
  { text: "SDK", link: "/sdk/" },
  { text: "企业管控台", link: "/guide" },
  { text: "功能清单", link: "/specs/" },
];

// specs sidebar: generated from docs/specs/<group>/*.md, ordered the same as
// the index table (frontmatter `order`, then path) — see spec-stats.mjs
const specsSidebar = collectSpecs().groups.map(({ dir, text, specs }) => ({
  text,
  collapsed: true,
  items: specs.map(({ path: rel }) => ({
    text: specTitle(
      fs.readFileSync(path.join(SPECS_DIR, rel), "utf-8"),
      rel.replace(/.*\//, "").replace(/\.md$/, ""),
    ),
    link: `/specs/${rel.replace(/\.md$/, "")}`,
  })),
}));

// 已按主题拆页的目录：`link` 是目录键（sidebar 按它挂分组），`pages` 是阅读顺序，
// 首项 `index` 是这个目录的索引页。sidebar 与 llms.txt 的目录都从这张表生成——
// 手写一份上百条的清单只会在改标题时悄悄漂移。
const SPLIT_DOCS = [
  {
    link: "/sdk/",
    pages: [
      "index",
      "agent-lifecycle",
      "messaging",
      "tools",
      "tool-artifact",
      "tool-exec",
      "sessions",
      "plugins",
      "memory",
      "background-tasks",
      "other-features",
      "builtin-skills",
      "builtin-subagents",
      "settings",
      "telemetry",
    ],
  },
  {
    link: "/tutorials/",
    pages: [
      "index",
      "scenario-tools",
      "figma-to-code",
      "sdd-case",
      "web-e2e-testing",
      "cloud-programming",
      "local-model",
      "knowledge-base",
      "metrics-governance",
      "code-security",
      "custom-workflow",
    ],
  },
  {
    link: "/desktop/",
    pages: [
      "index",
      "panels",
      "conversation",
      "code-and-permissions",
      "tasks-and-agents",
      "skills-memory-workflow",
      "automation",
      "coding-assist",
      "extensions",
      "settings",
    ],
  },
  {
    link: "/vsce/",
    pages: ["index", "gallery"],
  },
  {
    link: "/cli/",
    pages: [
      "index",
      "subcommands",
      "slash-commands",
      "keyboard-shortcuts",
      "permissions",
      "features",
    ],
  },
];

const docsRoot = path.dirname(SPECS_DIR);

const splitDocPages = (doc) =>
  doc.pages.map((slug) => ({
    slug,
    link: slug === "index" ? doc.link : `${doc.link}${slug}`,
    file: path.join(docsRoot, doc.link.slice(1, -1), `${slug}.md`),
  }));

// 与 VitePress（github-slugger）一致的标题 slug：非字母数字整段折成 `-`。
function headingSlug(text) {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^\d/.test(slug) ? `_${slug}` : slug;
}

function readHeadings(file) {
  const content = fs.readFileSync(file, "utf-8").replace(/```[\s\S]*?```/g, "");
  const headings = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (!m) continue;
    const explicit = m[2].match(/\{#([^}]+)\}\s*$/);
    const text = m[2].replace(/\s*\{#[^}]+\}\s*$/, "").trim();
    headings.push({
      level: m[1].length,
      text,
      id: explicit ? explicit[1] : headingSlug(text),
    });
  }
  return headings;
}

// 拆页目录的 sidebar 直接从各页标题生成：H1 是分组名，`##` 是一级条目、`###` 是它的
// 子条目。生成而不是手写，是因为 scripts/check-sidebar-anchors.mjs 要求每个 `##`/`###`
// 都能从 sidebar 点到——清单一旦落后于正文，这个检查就会红。
function docSidebar(doc) {
  return splitDocPages(doc).map(({ slug, link, file }) => {
    const headings = readHeadings(file);
    const title = headings.find((h) => h.level === 1)?.text ?? slug;
    const items = [];
    for (const heading of headings) {
      if (heading.level === 1) continue;
      const entry = { text: heading.text, link: `${link}#${heading.id}` };
      if (heading.level === 3 && items.length > 0 && items.at(-1).items) {
        items.at(-1).items.push(entry);
      } else if (heading.level === 2) {
        items.push({ ...entry, items: [] });
      } else {
        items.push(entry);
      }
    }
    // 没有子标题的 `##` 不必做成可折叠分组；页内没有 `##` 的页面（Artifact / Exec
    // 的正文就是参数表）直接链到页面本身。
    const normalized = items.map((item) =>
      item.items?.length
        ? { ...item, collapsed: true }
        : { text: item.text, link: item.link },
    );
    return {
      text: title,
      collapsed: false,
      items: normalized.length > 0 ? normalized : [{ text: "概览", link }],
    };
  });
}

const docsSidebar = Object.fromEntries(
  SPLIT_DOCS.map((doc) => [doc.link, docSidebar(doc)]),
);

// llms.txt 里每个拆页目录给自己一节，否则这些页只会落进 `### Other`。
//
// 注意是**平级的一节**，不是塞进「文档」组里的嵌套 items：插件处理嵌套分组时用
// `item.base ?? sectionBase ?? base` 取 base，而 sectionBase 是空串（`??` 不会跳过它），
// 站点 base 因此在嵌套分组里被吃掉——第一版就是这么把 SDK 链接写成没有
// `/wave-agent/` 前缀的 `/sdk/...` 的。
const llmsDocSections = SPLIT_DOCS.map((doc) => ({
  text: nav.find(({ link }) => link === doc.link)?.text ?? doc.link,
  items: splitDocPages(doc).map(({ slug, link }) => ({
    // 条目文案由插件从各页 frontmatter `title` 取，这里只给链接；索引页要写成目录名
    // （`/sdk` 而不是 `/sdk/`），否则插件归一后的路径匹配不上，那一页会掉进 `### Other`。
    text: slug,
    link: link.replace(/\/$/, ""),
  })),
}));

// llms.txt 的目录按这份「章节 → 页面」列表生成：插件只认 sidebar 形状的数据，
// 与 themeConfig.sidebar 是两回事。第一组是单页的站点导航顺序，后面接各拆页目录
// 与功能清单的分组。
const llmsSidebar = [
  {
    text: "文档",
    items: nav
      .filter(({ link }) => !SPLIT_DOCS.some((doc) => doc.link === link))
      .map(({ text, link }) => ({
        text,
        // 导航里写的是 `/specs/`；插件把 `specs/index.md` 归一成目录名 `/specs` 再比对，
        // 写成带斜杠的目录就匹配不上，那一页会掉进 `### Other`。
        link: link === "/specs/" ? "/specs" : link,
      })),
  },
  ...llmsDocSections,
  ...specsSidebar,
];

export default {
  // base 必须只有这一个来源：vitepress-plugin-llms 拼 llms.txt / llms-full.txt 里的链接
  // 时取的是这里，而不是 CLI 的 `--base`，两边不同源就会出现「HTML 资源指 /docs/、
  // llms.txt 链接指 /wave-agent/」的分裂。
  base: siteBase,
  title: "CodeWave IDE",
  description: "AI 辅助编程工具链 — SDK、CLI、VS Code 扩展与 JetBrains 插件",
  // rollup 给虚拟模块生成的 chunk 名带 `@` 前缀（vite 本地搜索索引即
  // `@localSearchIndexroot.<hash>.js`）。运维平台的文档包上传接口按
  // `[A-Za-z0-9._\-/]` 校验包内路径，`@` 判成非法会让整包 400 拒收。
  // 产物文件名只需 URL 安全，这里把非安全字符统一换成 `-`。
  vite: {
    plugins: [
      // 在 HTML 之外同时产出机器可读文本：`llms.txt`（按章节列出每页链接的目录）、
      // `llms-full.txt`（所有页面正文拼成一份）、以及每页同名的 `.md`。这样 agent 直接
      // 读源 markdown，不必做一遍会丢表格、丢代码围栏语言的 HTML→markdown 转换。
      // VitePress 官方没有已发布的等价能力（issue #4590 仍 open，PR #5313 还是
      // draft），它自己的文档站跑的就是这个插件。
      llmstxt({
        // 首页是「产品概览」，恰好是 agent 回答「这是什么工具」时最该先读的一页；
        // 插件默认排除它，是为那些首页只是空落地页的站点准备的。
        excludeIndexPage: false,
        // `llms-full.txt` 是把每页正文拼成一个大文件，塞进 docs/specs/（96 篇规格、
        // 约 2.2 MB 设计历史）会让它没法当上下文用；而这些规格仍需按页可读（`.md`
        // 与 llms.txt 目录里都有），所以只从 full 里排除。
        ignoreFilesPerOutput: { llmsFullTxt: ["specs/**"] },
        sidebar: llmsSidebar,
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          chunkFileNames: (chunkInfo) =>
            `assets/chunks/${chunkInfo.name.replace(/[^A-Za-z0-9._-]/g, "-")}.[hash].js`,
        },
      },
    },
  },
  themeConfig: {
    nav,
    search: { provider: "local" },
    sidebar: {
      "/specs/": specsSidebar,
      "/index": [
        {
          text: "产品概览",
          collapsed: false,
          items: [
            { text: "产品矩阵：六种形态", link: "/#产品矩阵-六种形态" },
            { text: "使用场景", link: "/#使用场景" },
            { text: "产品特色", link: "/#产品特色" },
            { text: "与 Claude Code 的对比", link: "/#vs-claude-code" },
            { text: "支持的操作系统", link: "/#支持的操作系统" },
          ],
        },
      ],
      "/guide": [
        {
          text: "管控台使用说明",
          collapsed: false,
          items: [
            { text: "一、企业管理员账号开通", link: "/guide#admin-account" },
            { text: "二、添加团队成员", link: "/guide#add-members" },
            {
              text: "方式一：通过邀请链接邀请成员加入",
              link: "/guide#invite-link",
            },
            { text: "方式二：配置 SSO 登录", link: "/guide#sso-login" },
            { text: "三、查看积分", link: "/guide#view-credits" },
            { text: "四、用量统计", link: "/guide#usage-stats" },
            { text: "套餐产品", link: "/guide#套餐产品" },
            { text: "API 额度", link: "/guide#api-额度" },
            { text: "使用明细", link: "/guide#使用明细" },
            { text: "五、订单管理", link: "/guide#orders" },
          ],
        },
      ],
      "/web": [
        {
          text: "Web 端使用文档",
          collapsed: false,
          items: [
            { text: "快速入门", link: "/web#快速入门" },
            {
              text: "手机上的界面",
              collapsed: false,
              items: [
                {
                  text: "会话列表",
                  link: "/web#会话列表",
                },
                {
                  text: "审批在手机上一样能批",
                  link: "/web#审批在手机上一样能批",
                },
                { text: "更多菜单", link: "/web#更多菜单" },
                { text: "顺口问一句（/btw）", link: "/web#顺口问一句-btw" },
                { text: "快捷指令弹窗", link: "/web#快捷指令弹窗" },
              ],
            },
            { text: "多台电脑", link: "/web#多台电脑" },
            { text: "断线与恢复", link: "/web#断线与恢复" },
            { text: "能力边界", link: "/web#能力边界" },
          ],
        },
      ],
      ...docsSidebar,
    },
  },
  head: [["link", { rel: "icon", href: "LOGO.png" }]],
};
