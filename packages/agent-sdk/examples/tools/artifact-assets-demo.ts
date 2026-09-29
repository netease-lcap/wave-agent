#!/usr/bin/env tsx

/**
 * Artifact 工具「列举 + 资源库」端到端示例（真实服务端，不走模型）
 *
 * 直接调用 Artifact 工具（不经过 Agent/模型），把每一步的 success / shortResult /
 * content / error 原样打印出来——即模型在对话里实际看到的内容，用来肉眼检查
 * 输出是否「顺」。
 *
 * 覆盖链路：
 * 1. `publish` 两个页面（源 artifact A、目标 artifact B）
 * 2. `upload_asset`：1x1 PNG（二进制）与 CSV（文本）→ 打印 `_blob/{id}` 引用形式
 * 3. 白名单拒绝：`.exe` 在本地被拒，不发起请求
 * 4. `list_assets`：资源列表 + 配额用量
 * 5. `read_asset`：PNG 落盘为临时文件（回读校验字节一致）；CSV 内联返回
 * 6. `copy_from`：把 A 的 PNG 复制到 B（顺序与 `asset_ids` 一致）
 * 7. `delete_asset`：删除 B 的副本，再删一次验证幂等
 * 8. `list`：列举账号可访问的 artifact（scope: mine）
 * 9. 清理：删除本次上传的全部资源，结束时两个 artifact 的 `files` 回到 0
 *
 * 前置条件：
 * - 已登录（~/.wave/auth.json 存在有效 SSO token）
 * - 服务端地址已配置：WAVE_SERVER_URL 环境变量（或走默认值）
 *
 * 运行：
 *   cd packages/agent-sdk && pnpm exec tsx examples/tools/artifact-assets-demo.ts
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { artifactTool } from "../../src/tools/artifactTool.js";
import { authService } from "../../src/services/authService.js";
import { clearArtifactSession } from "../../src/services/artifactSession.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";

/** 1x1 透明 PNG —— 用来走「二进制落盘」那条路径。 */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const CSV = "name,score\nwave,100\n";

const SESSION_ID = `artifact-assets-demo-${process.pid}`;

let failures = 0;

/** 打印模型实际看到的工具结果。 */
function show(label: string, result: ToolResult) {
  const status = result.success ? "OK  " : "FAIL";
  console.log(`\n${"─".repeat(72)}\n[${status}] ${label}`);
  if (result.shortResult) console.log(`  shortResult: ${result.shortResult}`);
  if (result.error) console.log(`  error: ${result.error}`);
  if (result.content) {
    console.log(
      result.content
        .split("\n")
        .map((line) => `  | ${line}`)
        .join("\n"),
    );
  }
  return result;
}

/** 断言成功；失败则计入统计并继续，方便一次跑完看到全貌。 */
function expectSuccess(label: string, result: ToolResult): ToolResult {
  if (!result.success) {
    failures++;
    console.log(
      `  ✗ ${label}：期望成功，但失败了 → ${result.error ?? "(无 error)"}`,
    );
  }
  return result;
}

/** 断言失败（负例），并打印错误文案供人工判断是否可操作。 */
function expectFailure(label: string, result: ToolResult): ToolResult {
  if (result.success) {
    failures++;
    console.log(`  ✗ ${label}：期望失败，但成功了`);
  }
  return result;
}

/**
 * 最小可用的 ToolContext：权限管理器只做两件事——把确认文案打印出来（模拟用户在
 * CLI 看到的确认框），以及按 workdir 判断可读区。
 */
function makeContext(workdir: string): ToolContext {
  let confirmations = 0;
  const permissionContext = { warning: "", hidePersistentOption: false };
  const permissionManager = {
    createContext: () => permissionContext,
    checkPermission: async () => {
      confirmations++;
      console.log(
        `\n  ⚠ 需要确认 #${confirmations}` +
          (permissionContext.warning
            ? `（隐藏「始终允许」）: ${permissionContext.warning}`
            : "（publish）"),
      );
      return { behavior: "allow" as const };
    },
    isPathInSafeZone: (target: string) => target.startsWith(workdir),
  };
  return {
    workdir,
    sessionId: SESSION_ID,
    permissionMode: "default",
    toolCallId: "demo-tool-call",
    permissionManager:
      permissionManager as unknown as ToolContext["permissionManager"],
  } as ToolContext;
}

async function main() {
  const serverUrl = authService.getServerUrl();
  console.log(`Server: ${serverUrl}`);
  console.log(
    `Logged in: ${authService.getSSOToken() ? "yes" : "NO — run /login first"}`,
  );
  if (!authService.getSSOToken()) process.exit(1);

  clearArtifactSession(SESSION_ID);

  const workdir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-artifact-assets-"),
  );
  const context = makeContext(workdir);
  console.log(`Workdir: ${workdir}`);

  await fs.writeFile(
    path.join(workdir, "page-a.html"),
    '<!DOCTYPE html><html><body><h1>Source page</h1><img src="_blob/PLACEHOLDER"></body></html>',
  );
  await fs.writeFile(
    path.join(workdir, "page-b.html"),
    "<!DOCTYPE html><html><body><h1>Target page</h1></body></html>",
  );
  await fs.writeFile(path.join(workdir, "logo.png"), ONE_PIXEL_PNG);
  await fs.writeFile(path.join(workdir, "data.csv"), CSV);
  await fs.writeFile(path.join(workdir, "installer.exe"), "MZ");

  const uploaded: Array<{ url: string; assetId: string; label: string }> = [];

  try {
    // 1. 发布两个页面
    const publishedA = expectSuccess(
      "publish A",
      await artifactTool.execute({ file_path: "page-a.html" }, context),
    );
    const urlA = /https?:\/\/\S+/.exec(publishedA.content ?? "")?.[0] ?? "";
    const publishedB = expectSuccess(
      "publish B",
      await artifactTool.execute({ file_path: "page-b.html" }, context),
    );
    const urlB = /https?:\/\/\S+/.exec(publishedB.content ?? "")?.[0] ?? "";
    show("publish page-a.html", publishedA);
    show("publish page-b.html", publishedB);
    if (!urlA || !urlB) throw new Error("publish 未返回 URL，后续步骤无法继续");

    // 2. 上传二进制与文本资源
    const uploadPng = expectSuccess(
      "upload logo.png",
      await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: urlA },
        context,
      ),
    );
    show("upload_asset logo.png → A", uploadPng);
    const pngId = /Asset uploaded: ([0-9a-f]{32})/.exec(
      uploadPng.content ?? "",
    )?.[1];
    if (pngId)
      uploaded.push({ url: urlA, assetId: pngId, label: "A/logo.png" });

    const uploadCsv = expectSuccess(
      "upload data.csv",
      await artifactTool.execute(
        { action: "upload_asset", file_path: "data.csv", url: urlA },
        context,
      ),
    );
    show("upload_asset data.csv → A", uploadCsv);
    const csvId = /Asset uploaded: ([0-9a-f]{32})/.exec(
      uploadCsv.content ?? "",
    )?.[1];
    if (csvId)
      uploaded.push({ url: urlA, assetId: csvId, label: "A/data.csv" });

    // 3. 白名单负例：不该发起任何请求
    show(
      "upload_asset installer.exe → A（期望失败）",
      expectFailure(
        ".exe 被拒",
        await artifactTool.execute(
          { action: "upload_asset", file_path: "installer.exe", url: urlA },
          context,
        ),
      ),
    );

    // 4. 列举资源
    show(
      "list_assets A",
      expectSuccess(
        "list_assets A",
        await artifactTool.execute(
          { action: "list_assets", url: urlA },
          context,
        ),
      ),
    );

    // 5. 读回资源：二进制落盘、文本内联
    if (pngId) {
      const readPng = expectSuccess(
        "read_asset png",
        await artifactTool.execute(
          { action: "read_asset", url: urlA, asset_id: pngId },
          context,
        ),
      );
      show(`read_asset ${pngId} (image/png)`, readPng);
      const written = /written to (\S+)/.exec(readPng.content ?? "")?.[1];
      if (written) {
        const onDisk = await fs.readFile(written).catch(() => null);
        console.log(
          `  ↳ 落盘校验: ${written} → ${onDisk ? `${onDisk.byteLength} bytes, 与上传一致: ${onDisk.equals(ONE_PIXEL_PNG)}` : "读不到"}`,
        );
        if (!onDisk?.equals(ONE_PIXEL_PNG)) failures++;
      } else {
        failures++;
        console.log("  ✗ 未返回落盘路径");
      }
    }
    if (csvId) {
      show(
        `read_asset ${csvId} (text/csv)`,
        expectSuccess(
          "read_asset csv",
          await artifactTool.execute(
            { action: "read_asset", url: urlA, asset_id: csvId },
            context,
          ),
        ),
      );
    }

    // 6. 复制到 B
    if (pngId) {
      const copied = expectSuccess(
        "copy_from png → B",
        await artifactTool.execute(
          {
            action: "copy_from",
            url: urlB,
            from: urlA,
            asset_ids: [pngId],
          },
          context,
        ),
      );
      show(`copy_from A → B（${pngId}）`, copied);
      const copyId = /→ ([0-9a-f]{32})/.exec(copied.content ?? "")?.[1];
      show(
        "list_assets B（复制结果）",
        expectSuccess(
          "list_assets B",
          await artifactTool.execute(
            { action: "list_assets", url: urlB },
            context,
          ),
        ),
      );

      // 7. 删除 + 幂等
      if (copyId) {
        show(
          `delete_asset ${copyId}（B）`,
          expectSuccess(
            "delete 副本",
            await artifactTool.execute(
              { action: "delete_asset", url: urlB, asset_id: copyId },
              context,
            ),
          ),
        );
        show(
          `delete_asset ${copyId}（再来一次）`,
          expectSuccess(
            "delete 幂等",
            await artifactTool.execute(
              { action: "delete_asset", url: urlB, asset_id: copyId },
              context,
            ),
          ),
        );
      }
    }

    // 8. 列举 artifact
    const listed = expectSuccess(
      "list",
      await artifactTool.execute({ action: "list", limit: 10 }, context),
    );
    show("list（scope: mine, limit: 10）", listed);
    for (const url of [urlA, urlB]) {
      const slug = url.split("/").pop() ?? "";
      if (!(listed.content ?? "").includes(`/code/artifact/${slug}`)) {
        failures++;
        console.log(`  ✗ list 结果里没有刚发布的 ${slug}`);
      }
    }
    show(
      "list limit: 51（期望失败）",
      expectFailure(
        "limit 上限",
        await artifactTool.execute({ action: "list", limit: 51 }, context),
      ),
    );

    // 9. 清理
    console.log(`\n${"─".repeat(72)}\n清理本次上传的资源`);
    for (const asset of uploaded) {
      const removed = await artifactTool.execute(
        { action: "delete_asset", url: asset.url, asset_id: asset.assetId },
        context,
      );
      console.log(`  ${asset.label}: ${removed.content || removed.error}`);
      if (!removed.success) failures++;
    }
    for (const [name, url] of [
      ["A", urlA],
      ["B", urlB],
    ] as const) {
      const after = await artifactTool.execute(
        { action: "list_assets", url },
        context,
      );
      console.log(`  ${name} 剩余: ${after.content?.split("\n")[0]}`);
    }
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
    clearArtifactSession(SESSION_ID);
  }

  console.log(
    `\n${failures === 0 ? "全部通过" : `${failures} 处不符合预期`}（临时目录已清理，服务端资源已删除）`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
