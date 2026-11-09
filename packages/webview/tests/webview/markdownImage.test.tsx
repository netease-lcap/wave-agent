/**
 * markdown 图片语法的渲染与点击（spec ui/markdown-images.md）。
 *
 * 修复前 `![alt](本地路径)` 走 marked 默认实现，产出 `<img src=路径>` 原样交给
 * 浏览器：页面 origin 不是会话工作目录（桌面端页面自己是 `file://…/webview/`、
 * 插件端是 `vscode-webview://`、远控页是站点根），桌面 CSP 又只放行
 * `self data: https:`，DOMPurify 还会把 `file:` 与盘符写法的 src 整条剥掉——
 * 用户看到的就是「破图标 + alt 文本」：图看不到，文件在哪也不知道。
 *
 * 现在本地路径降级成与其它路径通道同一个可点击元素（`a.file-path-link`），
 * 点击路由完全复用；`data:` / `http(s):` 仍然内联显示 `<img>`（页面自己取得到）。
 * 取不到的（远端 404、桌面 CSP 拦下的 `http:`、坏 data URL）由正文容器上的
 * 捕获阶段 `error` 监听就地换成文字，不留破图标（第二则用户故事）。
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { marked } from "marked";
import React from "react";
import {
  Message,
  createMessageMarkdownRenderer,
} from "../../src/components/Message";
import { toAbsoluteFilePath } from "../../src/utils/messageUtils";
import { MockDataGenerator } from "../fixtures/mockData";
import { createMockVscode } from "./test-utils";

const WORKDIR = path.resolve("/fake/project");
const RELATIVE_SRC = "screenshots/before-05.png";

function showMessage(
  content: string,
  options: {
    workdir?: string;
    onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
  } = {},
) {
  const vscode = createMockVscode();
  const result = render(
    <Message
      message={MockDataGenerator.createAssistantMessage(content)}
      vscode={vscode}
      workdir={options.workdir ?? WORKDIR}
      onOpenFile={options.onOpenFile}
    />,
  );
  return { ...result, vscode };
}

/** 唯一那条降级链接（断言「不是 <img>」时同时拿它做后续操作）。 */
function imageLink(container: HTMLElement): HTMLElement {
  const link = container.querySelector("a.file-path-link.md-image-link");
  expect(link).not.toBeNull();
  return link as HTMLElement;
}

afterEach(() => {
  delete window.waveRemotePage;
  vi.restoreAllMocks();
});

describe("markdown 图片：本地路径降级为路径链接", () => {
  it("相对路径不产出 <img>，产出路径链接，alt 落到 title", () => {
    const { container } = showMessage(
      `改前 ![before](${RELATIVE_SRC})：环画在盒外`,
    );

    expect(container.querySelector("img")).toBeNull();
    const link = imageLink(container);
    expect(link.textContent).toBe(RELATIVE_SRC);
    expect(link.getAttribute("title")).toBe("before");
  });

  it("点击相对路径：按会话 workdir 拼成绝对路径再交给宿主", () => {
    const onOpenFile = vi.fn();
    const { container } = showMessage(`![before](${RELATIVE_SRC})`, {
      onOpenFile,
    });

    const notPrevented = fireEvent.click(imageLink(container));

    expect(notPrevented).toBe(false);
    expect(onOpenFile.mock.calls[0]?.[0]).toBe(
      toAbsoluteFilePath(RELATIVE_SRC, WORKDIR),
    );
  });

  it("没有 workdir 时把相对路径原样交给宿主（宿主按自己的 cwd 解析）", () => {
    const onOpenFile = vi.fn();
    const vscode = createMockVscode();
    const { container } = render(
      <Message
        message={MockDataGenerator.createAssistantMessage(
          `![before](${RELATIVE_SRC})`,
        )}
        vscode={vscode}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(imageLink(container));

    expect(onOpenFile.mock.calls[0]?.[0]).toBe(RELATIVE_SRC);
  });

  it("盘符绝对路径：链接显示原文，点击发规范化后的绝对路径", () => {
    const onOpenFile = vi.fn();
    const { container } = showMessage("![after](C:/shots/after.png)", {
      onOpenFile,
    });

    const link = imageLink(container);
    expect(link.textContent).toBe("C:/shots/after.png");
    fireEvent.click(link);

    expect(onOpenFile.mock.calls[0]?.[0]).toBe("C:/shots/after.png");
  });

  it("file:// 形式：先剥 scheme 再发宿主（与其它路径通道同一条解析）", () => {
    const onOpenFile = vi.fn();
    const { container } = showMessage("![after](file:///home/u/a.png)", {
      onOpenFile,
    });

    fireEvent.click(imageLink(container));

    expect(onOpenFile.mock.calls[0]?.[0]).toBe("/home/u/a.png");
  });

  it("非图片扩展名同样降级（是不是图由宿主判，页面不替文件下结论）", () => {
    const { container } = showMessage("![x](notes.txt)");

    expect(container.querySelector("img")).toBeNull();
    expect(imageLink(container).textContent).toBe("notes.txt");
  });

  it("嵌在链接里时不产生嵌套 <a>（沿用剥路径链接的既有规则）", () => {
    const { container } = showMessage(
      `[![alt](${RELATIVE_SRC})](https://example.com/report)`,
    );

    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/report");
    expect(container.querySelector("a.file-path-link")).toBeNull();
  });

  it("远控页：降级链仍可点，走按需取图通道", () => {
    window.waveRemotePage = true;
    const { container, vscode } = showMessage(`![before](${RELATIVE_SRC})`);

    act(() => {
      fireEvent.click(imageLink(container));
    });

    const posted = vscode.postMessage.mock.calls.map(
      ([message]) => message as Record<string, unknown>,
    );
    expect(posted).toContainEqual(
      expect.objectContaining({
        command: "getImagePreview",
        path: toAbsoluteFilePath(RELATIVE_SRC, WORKDIR),
      }),
    );
  });
});

describe("markdown 图片：页面自己取得到的地址保持内联", () => {
  it("https 图片仍是 <img>（不是路径链接）", () => {
    const { container } = showMessage("![shot](https://example.com/a.png)");

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
    expect(container.querySelector("a.file-path-link")).toBeNull();
  });

  it("data: 图片仍是 <img>", () => {
    const { container } = showMessage(
      "![dot](data:image/png;base64,iVBORw0KGgo=)",
    );

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(container.querySelector("a.file-path-link")).toBeNull();
  });
});

describe("markdown 图片：档位 off 退化为纯文本", () => {
  it("pathLinkMode=off 时不生成链接也不生成 <img>", () => {
    const html = marked.parse(`![before](${RELATIVE_SRC})`, {
      renderer: createMessageMarkdownRenderer("off"),
    }) as string;

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).toContain(RELATIVE_SRC);
  });
});

describe("markdown 图片：加载失败就地降级（不留破图标）", () => {
  /**
   * 真浏览器会真的去取图，取不到时自己派发 `error`——但什么时候回来（甚至回不回
   * 来）取决于网络与缓存，用例不能等它。这里手动派发同一条事件。`error` 不冒泡，
   * 但捕获阶段依然会经过祖先节点——这正是实现选择容器捕获监听的原因。
   */
  function failImage(container: HTMLElement): HTMLImageElement {
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    img!.dispatchEvent(new Event("error"));
    return img as HTMLImageElement;
  }

  it("https 404：<img> 被换成 alt 文本，title 保留原地址", () => {
    const { container } = showMessage(
      "![改前](https://example.com/shots/missing.png)",
    );

    failImage(container);

    expect(container.querySelector("img")).toBeNull();
    const broken = container.querySelector(".md-image-broken");
    expect(broken?.textContent).toBe("改前");
    expect(broken?.getAttribute("title")).toBe(
      "https://example.com/shots/missing.png",
    );
  });

  it("没有 alt 时用地址里的文件名（去掉 query）", () => {
    const { container } = showMessage(
      "![](https://example.com/shots/before-05.png?v=2)",
    );

    failImage(container);

    const broken = container.querySelector(".md-image-broken");
    expect(broken?.textContent).toBe("before-05.png");
    expect(broken?.getAttribute("title")).toBe(
      "https://example.com/shots/before-05.png?v=2",
    );
  });

  it("坏 data URL：用 alt；没有 alt 用「图片」，title 不放 base64", () => {
    const brokenData = "data:image/png;base64,not-a-real-image";
    const withAlt = showMessage(`![截图](${brokenData})`);

    failImage(withAlt.container);

    const broken = withAlt.container.querySelector(".md-image-broken");
    expect(broken?.textContent).toBe("截图");
    expect(broken?.getAttribute("title")).toBeNull();
    expect(withAlt.container.textContent).not.toContain("base64");

    const noAlt = showMessage(`![](${brokenData})`);
    failImage(noAlt.container);
    expect(noAlt.container.querySelector(".md-image-broken")?.textContent).toBe(
      "图片",
    );
  });

  it("加载成功的图片不受影响", () => {
    const { container } = showMessage("![shot](https://example.com/a.png)");

    expect(container.querySelector(".md-image-broken")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("非图片元素抛出的 error 不会被降级", () => {
    const { container } = showMessage("![shot](https://example.com/a.png)");
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();

    paragraph!.dispatchEvent(new Event("error"));

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector(".md-image-broken")).toBeNull();
  });

  it("同一张图在流式重渲染后重新尝试，失败再降级（不累积占位）", () => {
    const vscode = createMockVscode();
    const { container, rerender } = render(
      <Message
        message={MockDataGenerator.createAssistantMessage(
          "![改前](https://example.com/missing.png)",
        )}
        vscode={vscode}
        workdir={WORKDIR}
      />,
    );
    failImage(container);
    expect(container.querySelectorAll(".md-image-broken")).toHaveLength(1);

    rerender(
      <Message
        message={MockDataGenerator.createAssistantMessage(
          "![改前](https://example.com/missing.png)\n\n下一段",
        )}
        vscode={vscode}
        workdir={WORKDIR}
      />,
    );

    expect(container.querySelector(".md-image-broken")).toBeNull();
    failImage(container);
    expect(container.querySelectorAll(".md-image-broken")).toHaveLength(1);
  });
});
