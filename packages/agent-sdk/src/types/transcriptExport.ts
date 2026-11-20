/**
 * `/export` 在**桌面端**这一形态的协议载荷（spec commands/export-command.md）。
 *
 * 与 CLI 的 `/export` 不同，桌面端产出一个归档（`transcript.jsonl` +
 * `transcript.md` + `manifest.json`），而转录可能躺在**另一台机器**上（ssh 主机、
 * WSL 发行版）——主进程读不到那个盘。所以「读转录」只能发生在拥有它的那个
 * `wave --stdio` 子进程里，通过一条 RPC 把三样东西换算好再回包（spec
 * desktop/desktop-export.md「远端会话的导出」）。
 *
 * 声明在这里（而不是服务层）的原因：这是跨进程过线的形状，宿主与 CLI 两侧都要
 * 用它，而 `/host` 只再导出 `types`。
 */

/** 一条 `/export` RPC 的回包：转录已经渲染好，宿主只负责落盘打包。 */
export interface TranscriptExportArchive {
  /** 可读版全文（Markdown）。 */
  markdown: string;
  /** `manifest.json` 的内容，已序列化好——宿主原样写进归档，不重算字段。 */
  manifestJson: string;
  /**
   * 原始转录字节的 base64。**原样拷贝**（不重新序列化）：重新拼一遍 JSONL 会把
   * 被中断的 append 残留、旧行序、非 ASCII 转义全都改掉，那份文件就不再是取证
   * 意义上的「原始转录」。
   *
   * 超过上限时**不带这个键**（只导出可读版，见 `jsonlTooLarge`）。
   */
  jsonlBase64?: string;
  /** 原始转录的字节数（超限时用它说「原始转录 X MB」）。 */
  jsonlBytes: number;
  /** 原始转录超过导出上限，归档里只有可读版。 */
  jsonlTooLarge: boolean;
}
