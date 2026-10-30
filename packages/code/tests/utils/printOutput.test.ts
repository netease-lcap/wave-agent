import { test, expect, vi, afterEach } from "vitest";
import type { ToolBlockUpdateCallbackParams } from "wave-agent-sdk";
import {
  installStdoutGuard,
  PrintOutput,
  STDOUT_GUARD_MARKER,
  uninstallStdoutGuard,
} from "../../src/utils/printOutput.js";

/** Collects whatever the output writes, so nothing reaches the real stdout. */
function collector() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (chunk: string) => void chunks.push(chunk),
    lines(): string[] {
      return chunks
        .join("")
        .split("\n")
        .filter((line) => line !== "");
    },
    json(): Record<string, unknown>[] {
      return this.lines().map((line) => JSON.parse(line));
    },
  };
}

function toolParams(
  overrides: Partial<ToolBlockUpdateCallbackParams> & { id: string },
): ToolBlockUpdateCallbackParams {
  return {
    messageId: "msg-1",
    stage: "running",
    name: "Bash",
    parameters: JSON.stringify({ command: "ls" }),
    ...overrides,
  } as ToolBlockUpdateCallbackParams;
}

const USAGES = [
  {
    prompt_tokens: 100,
    completion_tokens: 40,
    total_tokens: 140,
    model: "gpt-4",
    operation_type: "agent" as const,
    cache_read_input_tokens: 30,
  },
];

afterEach(() => {
  uninstallStdoutGuard();
  vi.restoreAllMocks();
});

test("json 模式只写一条 envelope，result 取最后一条助手消息的文本", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.assistantMessageAdded();
  output.contentDelta("msg-1", "第一段");
  output.assistantMessageAdded();
  output.contentDelta("msg-2", "最终答案");

  const envelope = output.result({
    sessionId: "session-1",
    durationMs: 1234,
    usages: USAGES,
  });

  expect(out.lines()).toHaveLength(1);
  expect(out.json()[0]).toEqual({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "最终答案",
    session_id: "session-1",
    num_turns: 2,
    duration_ms: 1234,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      cache_read_input_tokens: 30,
    },
    model_usage: {
      "gpt-4": {
        model: "gpt-4",
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        operations: { agent_calls: 1, compactions: 0 },
        cache_read_input_tokens: 30,
      },
    },
    tool_calls: [],
  });
  expect(envelope.result).toBe("最终答案");
});

test("结构化模式丢弃人读输出，诊断走 stderr", () => {
  const out = collector();
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const output = new PrintOutput({ format: "json", write: out.write });

  output.human("🔧 Bash\n");
  output.diag("worktree kept\n");

  expect(out.chunks).toEqual([]);
  expect(stderr).toHaveBeenCalledWith("worktree kept\n");
});

test("text 模式写人读输出，不写 envelope", () => {
  const out = collector();
  const output = new PrintOutput({ format: "text", write: out.write });

  output.human("🔧 Bash\n");
  output.diag("worktree kept\n");
  output.result({ sessionId: "s", durationMs: 1, usages: [] });

  expect(out.chunks).toEqual(["🔧 Bash\n", "worktree kept\n"]);
});

test("作废的半截消息不计入 result 与 num_turns", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.assistantMessageAdded();
  output.contentDelta("msg-1", "半截");
  output.assistantMessageDiscarded();
  output.assistantMessageAdded();
  output.contentDelta("msg-2", "重试后的完整答案");

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.result).toBe("重试后的完整答案");
  expect(envelope.num_turns).toBe(1);
});

test("工具调用按 id 去重：重复的 running 不重复记一条", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.toolUpdate(toolParams({ id: "call-1" }));
  // onShortResultUpdate 会带着 running 再发一次
  output.toolUpdate(toolParams({ id: "call-1", shortResult: "输出" }));
  output.toolUpdate(
    toolParams({ id: "call-1", stage: "end", success: true, result: "输出" }),
  );

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.tool_calls).toEqual([
    { id: "call-1", name: "Bash", input: { command: "ls" }, success: true },
  ]);
});

test("只有 end 没有 running（权限拒绝）也要进序列", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.toolUpdate(
    toolParams({
      id: "call-denied",
      stage: "end",
      name: "Write",
      parameters: JSON.stringify({ file_path: "a.txt" }),
      success: false,
      error: "Permission denied",
    }),
  );

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.tool_calls).toEqual([
    {
      id: "call-denied",
      name: "Write",
      input: { file_path: "a.txt" },
      success: false,
      error: "Permission denied",
    },
  ]);
});

test("工具参数不是合法 JSON 时保留原始字符串", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.toolUpdate(toolParams({ id: "call-1", parameters: "not json" }));

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.tool_calls[0].input).toBe("not json");
});

test("可恢复错误块 + 有正文 → 仍算成功", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.assistantMessageAdded();
  output.error("Failed to compact conversation history");
  output.contentDelta("m1", "这里是回答");

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.is_error).toBe(false);
  expect(envelope.subtype).toBe("success");
  expect(envelope.errors).toEqual(["Failed to compact conversation history"]);
  expect(envelope.result).toBe("这里是回答");
});

test("错误块非空且无正文 → 判为运行失败（模型不可用这类不抛错的失败）", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.error("HTTP 400 Bad Request: MODEL_NOT_ENABLED");

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.subtype).toBe("error_during_execution");
  expect(envelope.is_error).toBe(true);
  expect("result" in out.json()[0]).toBe(false);
  expect(envelope.errors).toEqual(["HTTP 400 Bad Request: MODEL_NOT_ENABLED"]);
});

test("只有工具调用、没有正文且报错时同样判为失败", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.toolUpdate(toolParams({ id: "call-1", stage: "running" }));
  output.toolUpdate(toolParams({ id: "call-1", stage: "end", success: true }));
  output.error("upstream timeout");

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
  });

  expect(envelope.is_error).toBe(true);
  expect(envelope.tool_calls).toHaveLength(1);
});

test("运行失败时不出 result 字段，errors 必填", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.error("boom");

  const envelope = output.result({
    sessionId: "s",
    durationMs: 1,
    usages: [],
    isError: true,
  });

  expect(envelope.subtype).toBe("error_during_execution");
  expect(envelope.is_error).toBe(true);
  expect(envelope.result).toBeUndefined();
  expect(envelope.errors).toEqual(["boom"]);
  expect("result" in out.json()[0]).toBe(false);
});

test("成功且无错误时 envelope 不带 errors 字段", () => {
  const out = collector();
  const output = new PrintOutput({ format: "json", write: out.write });

  output.result({ sessionId: "s", durationMs: 1, usages: [] });

  expect("errors" in out.json()[0]).toBe(false);
});

test("stream-json：init 在首位，事件按发生顺序，末行是 result", () => {
  const out = collector();
  const output = new PrintOutput({ format: "stream-json", write: out.write });

  output.init({
    sessionId: "session-1",
    model: "gpt-4",
    cwd: "/repo",
    permissionMode: "default",
    tools: ["Bash", "Read"],
  });
  output.assistantMessageAdded();
  output.reasoningDelta("msg-1", "想一想");
  output.contentDelta("msg-1", "答案");
  output.toolUpdate(toolParams({ id: "call-1" }));
  output.toolUpdate(toolParams({ id: "call-1", stage: "end", success: true }));
  output.error("工具报错");
  output.result({ sessionId: "session-1", durationMs: 9, usages: [] });

  const events = out.json();
  expect(events.map((event) => `${event.type}/${event.subtype ?? ""}`)).toEqual(
    [
      "system/init",
      "assistant/reasoning_delta",
      "assistant/content_delta",
      "tool/start",
      "tool/end",
      "error/",
      "result/success",
    ],
  );
  expect(events[0]).toEqual({
    type: "system",
    subtype: "init",
    session_id: "session-1",
    model: "gpt-4",
    cwd: "/repo",
    permission_mode: "default",
    tools: ["Bash", "Read"],
  });
  // 内容事件携带增量而不是累积快照
  expect(events[2]).toEqual({
    type: "assistant",
    subtype: "content_delta",
    message_id: "msg-1",
    delta: "答案",
  });
  expect(events[3]).toEqual({
    type: "tool",
    subtype: "start",
    message_id: "msg-1",
    tool_use_id: "call-1",
    name: "Bash",
    input: { command: "ls" },
  });
});

test("stream-json 不发 system/init 以外的元信息，json 模式不发任何事件", () => {
  const jsonOut = collector();
  const jsonOutput = new PrintOutput({
    format: "json",
    write: jsonOut.write,
  });
  jsonOutput.init({
    sessionId: "s",
    cwd: "/repo",
    permissionMode: "default",
    tools: [],
  });
  jsonOutput.contentDelta("msg-1", "答案");

  expect(jsonOut.chunks).toEqual([]);
});

test("stdout 守卫：非 JSON 行转到 stderr，JSON 行原样放行", () => {
  const stdout: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  installStdoutGuard();
  process.stdout.write('{"type":"result"}\n');
  process.stdout.write("这是依赖库的 console.log\n");

  expect(stdout).toEqual(['{"type":"result"}\n']);
  expect(stderr).toHaveBeenCalledWith(
    `${STDOUT_GUARD_MARKER} 这是依赖库的 console.log\n`,
  );

  uninstallStdoutGuard();
  stdoutSpy.mockRestore();
});
