/**
 * `WebFetch` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`WebFetchTool.ts:32-45` 的 outputSchema、`:300-306` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 的模型侧文本就是 `result` **原样**（`content: result`），渲染器不做任何拼装：
 *   小模型给出的答案、二进制落盘提示、跨主机重定向提示，全都写在 `result` 里。
 *   所以这是唯一一个「整段正文必须留在 `data`」的工具——留下的不是抓回来的网页
 *   正文（那份只喂给小模型，从不进 tool_result），而是这一次调用最终交给模型的
 *   那段文本；阶段 2 丢掉 `content` 之后靠它重建。
 * - `bytes` 是抓回来那份内容的字节数（`data` 说明就叫 "Size of the fetched
 *   content"）；重定向分支里 CC 取的是提示文本的字节数（`:238`），因为那次调用
 *   根本没有抓正文。
 * - `code` / `codeText` 是 HTTP 状态。CC 的重定向分支自己按状态码造状态文本
 *   （`:218-225`），我们直接取 `Response.status` / `Response.statusText`。
 * - `url` 是这次请求的地址（CC 的 "The URL that was fetched"，`:243`）。
 * - CC 的 `UI.tsx:34-62` 另有一套 `Received 1.2KB (200 OK)` 的终端 chrome，那不是
 *   模型侧文本，不进 `data`。
 */

export interface WebFetchResultData {
  /** 抓回来那份内容的字节数；重定向分支是提示文本的字节数。 */
  bytes: number;
  /** HTTP 响应码。 */
  code: number;
  /** HTTP 响应码文本（`OK` / `Moved Permanently` …）。 */
  codeText: string;
  /** 模型侧看到的全部文本——渲染器原样交出它（CC 的 `content: result`）。 */
  result: string;
  /** 整个调用（抓取 + 小模型处理）耗时。 */
  durationMs: number;
  /** 这次请求的 URL。 */
  url: string;
  /**
   * artifact 链接被读通道拦下时的身份（slug 与页面版本）；普通网页没有。
   * 正文不打印它，宿主卡片据此挂到对应 artifact 上。
   */
  artifactRead?: { slug: string; ver?: string };
}

/** CC 的渲染器没有别的拼装：`mapToolResultToToolResultBlockParam` 返回 `result`。 */
export function renderWebFetchResultData(data: WebFetchResultData): string {
  return data.result;
}

/**
 * `WebFetch` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：供 REPL 把工具签名渲染成真实返回类型（spec
 * core/repl-tool.md「公告分档呈现」），模型据此直接写 `const r = await
 * WebFetch(...); r.result`，不用先探一次。与 {@link WebFetchResultData}
 * 逐字段对应，改一处必须改另一处。
 */
export const webFetchOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    bytes: {
      type: "number",
      description:
        "Size of the fetched content in bytes; for a cross-host redirect, the size of the redirect notice.",
    },
    code: { type: "number", description: "HTTP response status code." },
    codeText: {
      type: "string",
      description: 'HTTP status text, e.g. "OK".',
    },
    result: {
      type: "string",
      description:
        "The whole model-facing text of this call: the answer, a saved-file note or a redirect notice.",
    },
    durationMs: {
      type: "number",
      description: "Wall-clock duration of the whole call in milliseconds.",
    },
    url: { type: "string", description: "The URL this call fetched." },
    artifactRead: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Artifact slug the read channel resolved.",
        },
        ver: {
          type: "string",
          description: "Page version read; omitted when the read carried none.",
        },
      },
      required: ["slug"],
      additionalProperties: false,
      description:
        "Present only when an artifact URL was read through the artifact read channel.",
    },
  },
  required: ["bytes", "code", "codeText", "result", "durationMs", "url"],
  additionalProperties: false,
};
