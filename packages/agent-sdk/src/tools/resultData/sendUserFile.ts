/**
 * `SendUserFile` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 2）。
 *
 * 形状照 CC：输出 schema 在 `2045-20663B-SendUserFileTool.js:275`（局部名 `M`），
 * 单个 attachment 的 schema 是 `gpr`（`0876-10328B-gpr.js:39`）。顶层四个字段
 * `caption` / `display` / `attachments` / `rendered_locally`，attachment 里我方
 * 对齐的是 `path` / `size` / `isImage` 三个。
 *
 * CC 有、我方没有的字段（都没有产生点，不进 `data`）：
 * - `display`（`render` / `attach`）：CC 的入参，客户端据此决定内嵌预览还是下载卡
 *   片。我方没有这个入参，点击路由由 `kind` 决定（`webview/src/utils/deliveredFiles.ts`）。
 * - attachment 的 `file_uuid` / `media_type` / `pathValidated` / `upload_error` /
 *   `upload_error_code` / `upload_suspected_limit_bytes` / `scaled` / `thumbnail` /
 *   `project_path`：全部属于 CC 的「上传到会话的一份副本」通道（图片缩放成 PNG/JPEG
 *   再上传、项目的共享目录、远端会话的投递结果）。我方只交付本机路径，没有这一层。
 * - `rendered_locally`：CC 用来标注「远端（手机/网页）看不到，只有这台机器的桌面端
 *   能看到」。我方投递的就是本机路径，卡片在哪个端渲染由宿主决定，这个标志没有
 *   判据，也没有消费方。
 *
 * 我方扩展字段（CC 无对应）：`name`（卡片标签）与 `kind`（点击路由）。CC 的客户端
 * 靠文件类型自己推导这两件事，我方的分类是三端共用的一份常量
 * （`constants/deliverableFiles.ts`），所以随结果传下去，避免宿主各自猜。
 *
 * 正文照 CC 的 `mapToolResultToToolResultBlockParam`（`2045-…:408`）在「没有上传
 * 通道」那一档的样子：一句 `N file(s) delivered to user.`，外加 `dh()` 分支那句
 * 「卡片位置取决于客户端，用文件名指代，别说上面/下面」。CC 在该档不逐条列路径
 * （路径行只出现在 `file_uuid` / `project_path` 两个档，我方都没有）。
 * `Caption:` 与可执行文件那句是我方自有正文，逐字保留。
 */

import {
  isBlockedExecutablePath,
  type DeliverableKind,
} from "../../constants/deliverableFiles.js";

/** CC `gpr`（`0876-10328B-gpr.js:39`）的我方子集。 */
export interface SendUserFileAttachmentData {
  /** CC 同名：绝对路径，宿主点开时解析的基准。 */
  path: string;
  /** CC 同名：字节数。 */
  size: number;
  /** CC 同名：是不是图片（宿主据此选预览还是编辑器）。 */
  isImage: boolean;
  /** 我方扩展（CC 由客户端按类型推导）：卡片上显示的名字。 */
  name: string;
  /** 我方扩展（CC 由客户端推导）：点击路由。 */
  kind: DeliverableKind;
}

export interface SendUserFileResultData {
  /** CC 同名：卡片上那行说明。 */
  caption?: string;
  /** CC 同名：交付成功的文件（失败是整次调用失败，不会半份）。 */
  attachments: SendUserFileAttachmentData[];
}

export function renderSendUserFileResultData(
  data: SendUserFileResultData,
): string {
  const count = data.attachments.length;
  const lines = [
    `${count} ${count === 1 ? "file" : "files"} delivered to user.`,
    // CC `:455` 的 `dh()` 分支：同一个会话可能在桌面端、插件端或 CLI 里读，卡片
    // 相对正文的位置各不相同，所以让模型用文件名指代。
    "Each file shows as a card whose position relative to your text depends on the app the user is reading in, so refer to a file by its name, never as above or below.",
  ];
  if (data.caption) lines.push(`Caption: ${data.caption}`);
  // 我方扩展：交付时不禁可执行文件（用户要的是那个文件），拦的是「打开」——
  // 这句话让模型知道别指望它被启动，也就不会重试。
  if (data.attachments.some((file) => isBlockedExecutablePath(file.path))) {
    lines.push("Executables are shown but never opened.");
  }
  return lines.join("\n");
}
