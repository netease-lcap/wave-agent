/**
 * webview 原型预览服务的 Vite 配置（本地人工测试用，非产品功能）。
 *
 * 与正式构建（esbuild → dist/chat.js）无关：
 * - dev：直接以 src/ 下真实组件为入口做模块级 HMR：改组件保留状态（React
 *   Fast Refresh）、改 CSS 即时生效、改 mock 用例自动重载——无需手动刷新。
 * - build（pnpm -F wave-webview build:prototype）：产出**单个自包含 HTML**
 *   （JS/CSS/字体全内联，vite-plugin-singlefile），用于发布 artifact 分享给
 *   设计师/评审。artifact 是 srcdoc sandbox iframe（origin null），外链资源
 *   相对路径必然 404，所以必须单文件。
 * - 复用 packages/webview/theme/ 的 theme-base-{light,dark}.css，按 desktop
 *   syncWebview.mjs 的同一机制改写为 `:root[data-theme="..."]`，通过切换
 *   <html data-theme> 换主题——与真机 desktop 行为完全一致（FR-018）。
 * - mock 用例在 prototype/mock/*.ts（gitignore，仅本地），由页面工具条加载。
 *
 * 启动：pnpm -F wave-webview preview （PORT 环境变量可覆盖，默认 8899）
 * 构建：pnpm -F wave-webview build:prototype → prototype/dist/index.html
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

const PROTOTYPE_DIR = path.resolve(import.meta.dirname);
const WEBVIEW_ROOT = path.resolve(PROTOTYPE_DIR, "..");

const PORT = Number(process.env.PORT || 8899);

/**
 * 把 theme-base-{light,dark}.css 的 `:root { ... }` 改写为
 * `:root[data-theme="..."] { ... }`，与 desktop syncWebview.mjs 的
 * rewriteThemeBase 同一逻辑，使两套变量集共存并随 <html data-theme> 切换。
 */
function rewriteThemeBase(): Plugin {
  return {
    name: "wave-preview-theme-base",
    transform(code, id) {
      const filename = path.basename(id);
      if (filename === "theme-base-light.css") {
        return {
          code: code.replace(/:root\s*\{/g, ':root[data-theme="light"] {'),
          map: null,
        };
      }
      if (filename === "theme-base-dark.css") {
        return {
          code: code.replace(/:root\s*\{/g, ':root[data-theme="dark"] {'),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig(({ command }) => {
  const isBuild = command === "build";
  return {
    root: PROTOTYPE_DIR,
    // build 用相对 base：单 HTML 会被塞进 srcdoc iframe / file:// 打开，
    // 绝对路径会解析到错误位置。
    base: isBuild ? "./" : "/",
    plugins: [react(), rewriteThemeBase(), viteSingleFile()],
    resolve: {
      alias: isBuild
        ? [
            // build 裁掉 ~2MB 的 mermaid（正则锚定，避免误伤 mermaid/xxx 子路径）；
            // dev 保留真实图表。见 prototype/mermaid-stub.ts。
            {
              find: /^mermaid$/,
              replacement: path.resolve(PROTOTYPE_DIR, "mermaid-stub.ts"),
            },
          ]
        : [],
    },
    server: {
      port: PORT,
      strictPort: true,
      fs: {
        // 允许访问 webview 根（src/theme/node_modules）与 monorepo 内依赖
        allow: [WEBVIEW_ROOT, path.resolve(WEBVIEW_ROOT, "../../..")],
      },
    },
    build: {
      outDir: path.resolve(PROTOTYPE_DIR, "dist"),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
