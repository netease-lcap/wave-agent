import {
  createResumeAccumulator,
  type TranscriptSnapshot,
} from "../../src/services/sessionEntries.js";
import type { Message } from "../../src/types/index.js";

/**
 * 测试替身：把一个「整份消息数组 + 标题」折成恢复快照。
 *
 * 折叠规则（按 id 去重保留第一次、压缩边界重置尾部、收集用量）只在生产代码
 * `createResumeAccumulator` 里写一份，这里只负责把数组伪装成一次扫描。会 mock
 * `JsonlHandler` 的测试都用它喂 `readTranscriptForResume`，避免每个文件各写一遍
 * 折叠语义、并且与生产代码悄悄走偏。
 */
export function resumeSnapshotOf(
  messages: Message[],
  customTitle?: string,
): TranscriptSnapshot {
  const accumulator = createResumeAccumulator();
  if (customTitle) accumulator.push({ kind: "custom-title", customTitle });
  for (const message of messages) {
    accumulator.push({ kind: "message", message });
  }
  return accumulator.snapshot();
}
