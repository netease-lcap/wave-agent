/**
 * 原型预览服务的 mock 用例类型。
 *
 * `prototype/mock/` 目录下的每个 `.ts` 文件导出一个 MockCase（default export）。
 * 该目录整体被 gitignore（仅本地 mock，不提交仓库）；格式示例见 `mock/README.md`。
 */

export interface MockMessage {
  /** 发送前等待的毫秒数（默认 0） */
  delay?: number;
  /** host → webview 消息（与真实宿主 postMessage 的 payload 一致） */
  message: Record<string, unknown>;
}

export interface MockHelpers {
  /** 立即向 webview 发送一条 host → webview 消息 */
  send: (message: Record<string, unknown>) => void;
  /** 延迟 delayMs 毫秒后发送一条 host → webview 消息 */
  sendAfter: (delayMs: number, message: Record<string, unknown>) => void;
}

export interface MockCase {
  /** 工具条下拉框中显示的名称 */
  name: string;
  /** 工具条下拉框中显示的描述（可选） */
  description?: string;
  /** 用例运行的宿主外壳："desktop" 渲染桌面端外壳（侧边栏/账户卡片），缺省为 IDE 聊天 */
  host?: "desktop" | "ide";
  /** 用例激活时按序发送的 host → webview 消息 */
  messages?: MockMessage[];
  /**
   * 收到 webview → host 消息时的响应规则。
   * key 为 webview 发出的 command（如 "getConfiguration"、"setAgentsContent"），
   * 命中后用 helpers.send 回发响应（如 { command: "configurationResponse", ... }）。
   */
  responders?: Record<
    string,
    (payload: Record<string, unknown>, helpers: MockHelpers) => void
  >;
}
