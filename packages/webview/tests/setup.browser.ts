import "@testing-library/jest-dom/vitest";
import { userEvent } from "vitest/browser";
import { beforeAll, beforeEach, vi } from "vitest";
import { createCodeEditor } from "../src/components/fileEditor/createCodeEditor";
import { createReadOnlyCodeView } from "../src/components/fileEditor/createReadOnlyCodeView";

/**
 * Browser-mode setup: everything the real Chromium environment still needs —
 * and nothing else.
 *
 * The jsdom setup this replaces carried five polyfills (`scrollIntoView`,
 * `Element.scrollTo`, `offsetHeight`/`offsetWidth`, `DataTransfer`,
 * `innerText`) because jsdom does no layout and implements none of them. In a
 * real browser all five are native, so re-stubbing them here would hide the
 * very behaviour the suite is supposed to exercise.
 */
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});

// Heavy renderers stay mocked: mermaid needs fonts/layout to lay out a diagram
// and dompurify's sanitizer is exercised by its own dedicated specs. Both mocks
// live here (not in a shared test helper) because in browser mode a `vi.mock`
// registered from an imported helper lands after the module graph is built.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

// `localStorage` 是**按 worker 槽位共享**的，不是按文件：同一槽位里前一个文件
// 渲染过的 `DesktopChromeProvider` 会把状态留在页面上（实测下一个文件开头能读到
// 上一个文件写的 `wave.desktopSidebarGroupCollapsed`）。真机上这些键本来就该
// 跨会话保留（侧栏收起、分组折叠、视图偏好），所以组件不去清理；但它会在文件
// 之间串味 —— `desktopApp` 点过「收起侧边栏」之后，后面任何一个「假定侧栏是展开
// 的」文件都会找不到侧栏内容（表现成 flaky：单独跑绿、全量跑红，且红的文件随
// 调度顺序变化）。每个用例从干净存储起步，才是各文件相互独立的口径；放在
// `beforeEach`（而不是 `afterEach`）是为了不打断同一个文件里「先写后读」的用例。
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 沙箱 iframe（opaque origin）里 storage 一读就抛，那里本来也没有状态要清。
  }
});

// 真指针位置同样是**跨文件保留**的全局状态：provider 的 mouse 跟着 page 走，
// 而 page 在 worker 槽位里复用（`userEvent.pointer` 文档原话：target 与 coords
// 都不给时「uses the last known pointer position」）。上一个文件把指针停在消息
// 或按钮上，本文件开头第一条断言里的 `:hover` 就是命中的 —— CI 上
// `messageActionGeometry.test.tsx:111` 的「未悬停时按钮不可见」就这么红过
// （expected actionsDisplay none / visible false，received flex / true）。
//
// 移到视口左上角：那里没有可 hover 的元素。放 `beforeAll`（每文件一次）而不是
// `beforeEach`：每个用例一次 CDP 往返，2731 个用例要白吃十几秒，而残留只发生在
// 文件边界 —— 文件内部的悬停由用例自己负责复位。
beforeAll(async () => {
  await userEvent.pointer({ coords: { x: 0, y: 0 } });
});

// A few specs still write `globalThis.global` (node spelling). There is no
// `global` in a browser; alias it so those assertions keep working.
(globalThis as unknown as Record<string, unknown>).global = globalThis;

// The file panel reaches CodeMirror through a lazily injected desktop-only chunk
// (`./editor.js`), which this dev server never builds. Wiring the chunk's own
// source into the global stands in for that <script> tag: the specs drive the
// same editor the desktop host ships, without a bundling step. Loading is still
// asynchronous (one promise hop), so specs that touch the code surface await it.
window.WaveEditor = { createCodeEditor, createReadOnlyCodeView };
