/**
 * 远程控制 Web 页专用的 `mermaid` 替身：一个加载器，不是图表库本身。
 *
 * `remote/build.mjs` 用 `--lazy-mermaid=./mermaid.<hash>.js` 构建页面时，会把
 * `MermaidRenderer` 里那句 `import mermaid from "mermaid"` 别名到本文件，真正的
 * 图表库被单独打成一个约 3.3 MB 的 chunk，**只有真的渲染图表时才去取**。理由：
 * 这个页面是整个 bundle 唯一走 HTTP 的形态，而 mermaid 占了它的 78%（实测），
 * 为了「某条消息里可能有图」让每台手机首屏都下 3.3 MB 不划算。四个插件端
 * 照旧用内联了 mermaid 的 `dist/chat.js`。
 *
 * 两处约束撑住这件事：
 *
 * 1. 只镜像 `MermaidRenderer` 真正用到的那两个成员（`initialize` / `render`）。
 *    TypeScript 在这句 import 上看到的仍是真 mermaid（别名只存在于构建期），
 *    所以渲染器如果新增第三个成员，类型检查会过、页面上会运行时报错。
 * 2. chunk 的 URL 由构建期注入（esbuild `define`），但**不直接写进 `import()`**：
 *    字面量（包括 `String(…)` 这种能被求值的包装）会让 esbuild 在打包阶段就
 *    去解析它、把 chunk 打进 `chat.js`，正好抵消这次拆分。先落到一个变量上，
 *    打包器看到的是标识符而不是字面量，于是原样留在产物里，由浏览器按同目录的
 *    相对地址去取。
 */

import type { Mermaid } from "mermaid";

/** 页面真正需要的那部分 mermaid API。 */
type MermaidApi = Pick<Mermaid, "initialize" | "render">;

/** 构建期注入：按需 chunk 的相对地址（见 `remote/build.mjs`）。 */
declare const __WAVE_MERMAID_CHUNK_URL__: string;

/** 经变量中转，别让 esbuild 把它当成可解析的静态 import（见文件头第 2 条）。 */
const chunkUrl: string = __WAVE_MERMAID_CHUNK_URL__;

let pendingConfig: Parameters<MermaidApi["initialize"]>[0] | null = null;
let loading: Promise<MermaidApi> | null = null;

/** 取 chunk，只取一次；失败会让 `render` 抛出，落进消息里的错误区。 */
const load = (): Promise<MermaidApi> => {
  loading ??= import(chunkUrl)
    .then((mod) => {
      const api = (mod as { default?: MermaidApi }).default;
      if (!api) {
        throw new Error("chunk 里没有默认导出。");
      }
      return api;
    })
    .catch((err: unknown) => {
      // 页面被部署成少了这个 chunk（打包漏了），或者手机网络抖：这时要给一句
      // 人话，而不是把浏览器的 "Failed to fetch dynamically imported module"
      // 原样倒给用户。同时清掉缓存，让用户重试/下一条消息能再试一次。
      loading = null;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`图表组件加载失败，图表暂时无法渲染（${reason}）`);
    });
  return loading;
};

const lazyMermaid: MermaidApi = {
  // MermaidRenderer 在 render 之前同步调用它（外面有 try/catch），此时 chunk 还
  // 没到。所以这里只记下配置，等真的 load 完再用它 initialize —— 期间主题可能
  // 已经切过，用最后一份配置才对。
  initialize: (config) => {
    pendingConfig = config;
  },
  render: async (id, text) => {
    const api = await load();
    if (pendingConfig) {
      api.initialize(pendingConfig);
    }
    return api.render(id, text);
  },
};

export default lazyMermaid;
