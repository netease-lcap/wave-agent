import { formatSize } from "../../services/contentSummarizer.js";

/**
 * `Artifact` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC：CC 的 `Artifact` 不是单一 schema，而是按 action 判别的 **zod 联合**
 * （`2063-583154B-kpr.js:10636` 的 `get outputSchema()` 返回 `PIi()`；
 * `2058-125829B-hIi.js:1366` 的 `PIi` 用联合构造器 `We([...])` 拼了三十多个
 * per-action schema）。这里同样一支 action 一个 interface，判别键是 `action`。
 * 各支对齐的 CC schema（都在 `2058-125829B-hIi.js`）：publish `_r:442`、list
 * `Dr:753`、read `Fr:765`、upload_asset `qr:1110`、list_assets `Xr:1131`、
 * read_asset `Yr:1153`、copy_from `Kr:1166`、delete_asset `Jr:1180`。评论那族
 * （comments / reply / resolve）与 watch / unwatch / status 已随 #3059 从这里搬走
 * 或删除，这一段只覆盖 `Artifact` 工具自己还产出的 action。
 *
 * 文本口径**不照 CC**：我方这八个 action 的模型侧措辞早于本迁移写定（CC 的
 * `mapToolResultToToolResultBlockParam`，`2063:13884` 起按 `"<key>" in e` 分派，
 * 写的是另一套句子），本阶段只搬运 `data`，措辞逐字不变。
 *
 * 三条通用约定：
 *
 * - 正文也进 `data`（issue #3055 阶段 2 的口径：这些正文本来就落盘在 `content` 里，
 *   搬进 `data` 体积不变，而渲染器只有 `data` 一个入参）：`read` 的 `body`、
 *   `read_asset` 文本档的 `body`。除了「本来就没有文本形态」
 *   的分支（`read_asset` 既没 `path` 也没 `body`，不会出现），每个 action 都渲得出
 *   全文。
 * - 多处渲染要用的「渲染参数」（列表的 `maxLimit`）跟
 *   bash 的 `timeoutMs` 一样留在 `data` 里：渲染器只有 `data` 一个入参。
 * - 只 import 无副作用的叶子模块：`formatSize` 所在模块只有 `import type`，而
 *   `services/artifactAssets.ts` / `artifactContent.ts` 经 turndown 与 authService
 *   拖第三方依赖，不能进宿主读路径（`index.ts` 文件头的不变式），所以那里的
 *   `formatMiB` 在下面复制了一份。
 */

/**
 * 与 `services/artifactAssets.ts:102` 的 `formatMiB` 同形。
 *
 * 不 import 那边：它经 `artifactContent.ts` 把 turndown 与 authService 一起拖进
 * 宿主读路径。这里只有一行纯格式化，复制比让整个服务层陪跑便宜。
 */
function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

// --- publish ---

export interface ArtifactPublishResultData {
  action: "publish";
  /** CC `_r.url`（`:442`）：线上页面地址，正文第一行。 */
  url: string;
  /**
   * CC `_r.path`（`:442`）：服务端记下的发布路径。线上的版本号是数字，CC 的
   * schema 是字符串，这里统一成字符串。
   */
  path?: string;
  /** CC `_r.title`（`:442`）：服务端确认的标题；Markdown 发布没有。 */
  title?: string;
  /**
   * 我方扩展（CC 无对应）：宿主卡片上显示的那个名字，回退链是
   * `deploy.title → label → 文件名`。与正文的 `title` 不同源 —— 后者只认服务端回
   * 的标题，缺了正文就不打印 `Title:` 那一行。宿主渲染卡片用（原来是
   * `ToolResult.metadata.artifactTitle`）。
   */
  artifactTitle?: string;
  /** CC `_r.version`（`:442`）。 */
  version: string;
  /**
   * 我方扩展（CC 无对应）：共享状态那两行说明，由 `formatArtifactSharing` 整句
   * 产出（它在 `artifactContent.ts`，不能进宿主读路径）。照 bash 的
   * `interruptedReason` 先例，短句原样留在 `data` 里，渲染器负责摆位置。
   */
  sharing?: string;
}

export function renderArtifactPublishResultData(
  data: ArtifactPublishResultData,
): string {
  const lines = [`Artifact published: ${data.url}`];
  if (data.path) lines.push(`Path: ${data.path}`);
  if (data.title) lines.push(`Title: ${data.title}`);
  lines.push(`Version: ${data.version}`);
  if (data.sharing) lines.push(data.sharing);
  return lines.join("\n");
}

// --- list ---

export interface ArtifactListRowData {
  /** CC `Cr.title`（`:737`）。 */
  title: string;
  /** CC `Cr.url`（`:737`）：完整页面地址，由工具按当前 server 拼好。 */
  url: string;
  /** CC `Cr.rel`（`:737`）的词表：共享进来的与自己的。 */
  rel: "mine" | "shared";
  /** CC `Cr.favicon`（`:737`）。 */
  favicon?: string;
  /** CC `Cr.updatedAt`（`:737`）。 */
  updatedAt?: string;
}

export interface ArtifactListResultData {
  action: "list";
  /** CC `Dr.scope`（`:753`）；CC 只允许 shared / all，我方三档。 */
  scope: "mine" | "shared" | "all";
  /** CC `Dr.artifacts`（`:753`）：已经按 `limit` 截断过的那一页。 */
  artifacts: ArtifactListRowData[];
  /** CC `Dr.truncated`（`:753`）。 */
  truncated: boolean;
  /**
   * 我方扩展（CC 无对应）：正文那句 `raise "limit" (max N)` 的上限。CC 的 list
   * 结果里没有这个数，它的渲染器直接拼常量；渲染器只有 `data`，所以放这里。
   */
  maxLimit: number;
}

function formatListRow(row: ArtifactListRowData): string {
  const favicon = row.favicon ? `${row.favicon} ` : "";
  const updated = row.updatedAt ? ` (updated ${row.updatedAt})` : "";
  return `- ${favicon}${row.title} — ${row.url}${updated}`;
}

export function renderArtifactListResultData(
  data: ArtifactListResultData,
): string {
  const lines = [
    `Artifacts (scope: ${data.scope}) — ${data.artifacts.length} listed`,
  ];
  if (data.artifacts.length === 0) {
    lines.push("", "No artifacts matched.");
  } else {
    for (const rel of ["mine", "shared"] as const) {
      const group = data.artifacts.filter((row) => row.rel === rel);
      if (group.length === 0) continue;
      lines.push("", `(${rel})`);
      for (const row of group) lines.push(formatListRow(row));
    }
  }
  if (data.truncated) {
    lines.push(
      "",
      `More matches exist — raise "limit" (max ${data.maxLimit}) or narrow "scope".`,
    );
  }
  return lines.join("\n");
}

// --- read ---

export interface ArtifactReadResultData {
  action: "read";
  /** CC `Fr.read.url`（`:765`）：规范化的页面地址（裸 slug 也会被还原成 URL）。 */
  url: string;
  /** CC `Fr.artifactRead.ver`（`:765`）：页面版本，服务端没给就没有。 */
  version?: string;
  /** CC `Fr.owned`（`:765`）：自己拥有（原文直读）还是别人的（只给摘要）。 */
  ownership: "owner" | "reader";
  /** 我方扩展（CC 无对应）：`sharingNotice` 整句，理由同 publish 的 `sharing`。 */
  sharing?: string;
  /** CC `Fr.read.bytes`（`:765`）：读回来的 HTML 字节数。 */
  bytes?: number;
  /**
   * 正文全文。owner 档是读回来的 HTML 全文（过大时是它落盘后的
   * `<persisted-output>` 包装）；reader 档是快速模型对他人页面的摘要，**已经自带
   * `sharingNotice` 头与落盘说明**（`artifactContent.ts` 的
   * `summarizeArtifactAsReader` 拼好），所以 reader 档的文本就是它本身，不再加头部。
   */
  body: string;
}

/**
 * 文本 = 头部几行 + 正文（`data.body`）。
 *
 * owner 档与 reader 档的头部不同源：owner 档的头部由下面几行拼出来，reader 档的正文
 * 自己就带着 sharing 头（见 `ArtifactReadResultData.body`），所以那一档原样返回。
 */
export function composeArtifactReadText(data: ArtifactReadResultData): string {
  if (data.ownership === "reader") return data.body;
  const lines = [`Artifact: ${data.url}`];
  if (data.version) lines.push(`Version: ${data.version}`);
  if (data.sharing) lines.push(data.sharing);
  return `${lines.join("\n")}\n\n${data.body}`;
}

// --- upload_asset ---

export interface ArtifactUploadAssetResultData {
  action: "upload_asset";
  /** CC `en.id`（`:1102`）：`_blob/{id}` 里的那个资产 id。 */
  id: string;
  /**
   * CC `en.content_type`（`:1102`）：服务端回的 MIME，回空时用客户端按扩展名
   * 推断的那个（正文 `Type:` 一行显示的就是这个生效值）。
   */
  content_type: string;
  /** CC `en.size_bytes`（`:1102`）。 */
  size_bytes: number;
  /** CC `en.sha256`（`:1102`）。 */
  sha256?: string;
}

export function renderArtifactUploadAssetResultData(
  data: ArtifactUploadAssetResultData,
): string {
  const lines = [
    `Asset uploaded: ${data.id}`,
    `Reference it in the page as: _blob/${data.id}`,
    `Type: ${data.content_type}`,
    `Size: ${formatSize(data.size_bytes)}`,
  ];
  if (data.sha256) lines.push(`sha256: ${data.sha256}`);
  return lines.join("\n");
}

// --- list_assets ---

export interface ArtifactAssetRowData {
  /** CC `Xr.asset_list.assets[].id`（`:1131`）。 */
  id: string;
  /** CC 同名；空值渲染成 `unknown`。 */
  content_type?: string;
  size_bytes: number;
  created_at?: string;
}

export interface ArtifactListAssetsResultData {
  action: "list_assets";
  /** CC `Xr.asset_list.url`（`:1131`）：调用方给的那个写法（slug 也照原样回显）。 */
  url: string;
  assets: ArtifactAssetRowData[];
  /** CC `Xr.asset_list.usage`（`:1131`）的四项配额。 */
  usage: { files: number; bytes: number; max_files: number; max_bytes: number };
  /** CC `Xr.asset_list.next`（`:1131`）：下一页游标。 */
  next?: string;
}

export function renderArtifactListAssetsResultData(
  data: ArtifactListAssetsResultData,
): string {
  const lines = [
    `Assets of ${data.url} — ${data.usage.files}/${data.usage.max_files} file(s), ${formatSize(data.usage.bytes)} of ${formatMiB(data.usage.max_bytes)}`,
  ];
  if (data.assets.length === 0) {
    lines.push("", "No assets.");
  } else {
    lines.push("");
    for (const asset of data.assets) {
      const created = asset.created_at ? `  ${asset.created_at}` : "";
      lines.push(
        `- ${asset.id}  ${asset.content_type || "unknown"}  ${formatSize(asset.size_bytes)}${created}`,
      );
    }
  }
  if (data.next) {
    lines.push("", `More assets — call again with "after": "${data.next}"`);
  }
  return lines.join("\n");
}

// --- read_asset ---

export interface ArtifactReadAssetResultData {
  action: "read_asset";
  /** CC `Yr.asset_read.id`（`:1153`）。 */
  id: string;
  /** CC `Yr.asset_read.size_bytes`（`:1153`）。 */
  size_bytes: number;
  /** CC `Yr.asset_read.content_type`（`:1153`）：空值渲染成 octet-stream。 */
  content_type?: string;
  /**
   * CC `Yr.asset_read.path`（`:1153`）：二进制档落盘后的临时文件。
   * 文本档没有这个键——它走下面的 `body`。
   */
  path?: string;
  /**
   * 文本档的资产原文（过大时是它落盘后的 `<persisted-output>` 包装）。二进制档没有
   * 这个键：那些字节没有文本形态，只给落盘路径（`path`）。
   */
  body?: string;
}

/** `Asset <id> (<type>, <size>)` 那半句，文本档与二进制档共用。 */
function describeAsset(
  data: Pick<ArtifactReadAssetResultData, "id" | "size_bytes" | "content_type">,
): string {
  const type = data.content_type || "application/octet-stream";
  return `${data.id} (${type}, ${formatSize(data.size_bytes)})`;
}

/** 二进制档的正文。它一定落过盘，所以把 `path` 收进签名。 */
export function renderArtifactReadAssetFileText(
  data: ArtifactReadAssetResultData & { path: string },
): string {
  return `Asset ${describeAsset(data)} written to ${data.path}\nUse Read to view it.`;
}

/** 文本档的正文 = 一行描述 + 资产原文（`data.body`）。 */
export function composeArtifactReadAssetText(
  data: ArtifactReadAssetResultData & { body: string },
): string {
  return `Asset ${describeAsset(data)}\n\n${data.body}`;
}

// --- delete_asset ---

export interface ArtifactDeleteAssetResultData {
  action: "delete_asset";
  /** CC `Jr.asset_delete.id`（`:1180`）。 */
  id: string;
  /**
   * 我方扩展（CC 无对应）：正文里那句 `from <调用方给的 url>`。CC 的
   * `asset_delete` 结果不带这个值。
   */
  url: string;
  /** CC `Jr.asset_delete.deleted`（`:1180`）：false = 本来就不在。 */
  deleted: boolean;
}

export function renderArtifactDeleteAssetResultData(
  data: ArtifactDeleteAssetResultData,
): string {
  return data.deleted
    ? `Deleted asset ${data.id} from ${data.url}.`
    : `Asset ${data.id} was already gone — nothing was deleted.`;
}

// --- copy_from ---

export interface ArtifactCopyAssetRowData {
  /** CC `Kr.asset_copy.assets[].from_id`（`:1166`）。 */
  from_id?: string;
  /** CC `Kr.asset_copy.assets[].id`（`:1166`）：目标 artifact 里的新 id。 */
  id: string;
  content_type?: string;
  size_bytes: number;
}

export interface ArtifactCopyFromResultData {
  action: "copy_from";
  /** CC `Kr.asset_copy.from_url`（`:1166`）——但正文用的是解析后的 slug，故用我方名字。 */
  from: string;
  /** CC `Kr.asset_copy.url`（`:1166`）：目标 artifact 的原样写法。 */
  url: string;
  assets: ArtifactCopyAssetRowData[];
  /**
   * 我方扩展（CC 无对应）：正文那句 `Only N of M were confirmed` 的 M，也就是
   * 这次要求的 id 个数。CC 的 `asset_copy` 结果里没有它。
   */
  requested: number;
}

export function renderArtifactCopyFromResultData(
  data: ArtifactCopyFromResultData,
): string {
  const lines = [
    `Copied ${data.assets.length} asset(s) from ${data.from} into ${data.url}:`,
  ];
  for (const copy of data.assets) {
    lines.push(
      `- ${copy.from_id ?? "?"} → ${copy.id}  ${copy.content_type || "unknown"}  ${formatSize(copy.size_bytes)}`,
    );
  }
  if (data.assets.length !== data.requested) {
    lines.push(
      "",
      `Only ${data.assets.length} of ${data.requested} were confirmed — run list_assets on the target to check.`,
    );
  }
  return lines.join("\n");
}

// --- 联合与按 action 派发 ---

export type ArtifactResultData =
  | ArtifactPublishResultData
  | ArtifactListResultData
  | ArtifactReadResultData
  | ArtifactUploadAssetResultData
  | ArtifactListAssetsResultData
  | ArtifactReadAssetResultData
  | ArtifactDeleteAssetResultData
  | ArtifactCopyFromResultData;

/**
 * 按 `data.action` 派发到该支的渲染器。
 *
 * 八个 action 都能从 `data` 渲出全文（阶段 2 口径：正文搬进 `data`）。唯一的
 * `undefined` 是 `read_asset` 既没有 `path`（二进制档的落盘文件）也没有 `body`
 * （文本档的原文）—— 那份 `data` 里确实没有可渲染的东西，属于「数据不全」而不是
 * 「没有文本形态」，调用方据此退回工具当场的 `content`。
 */
export function renderArtifactResultData(
  data: ArtifactResultData,
): string | undefined {
  switch (data.action) {
    case "publish":
      return renderArtifactPublishResultData(data);
    case "list":
      return renderArtifactListResultData(data);
    case "read":
      return composeArtifactReadText(data);
    case "upload_asset":
      return renderArtifactUploadAssetResultData(data);
    case "list_assets":
      return renderArtifactListAssetsResultData(data);
    case "read_asset":
      if (data.path) {
        return renderArtifactReadAssetFileText({ ...data, path: data.path });
      }
      return data.body === undefined
        ? undefined
        : composeArtifactReadAssetText({ ...data, body: data.body });
    case "delete_asset":
      return renderArtifactDeleteAssetResultData(data);
    case "copy_from":
      return renderArtifactCopyFromResultData(data);
  }
}
