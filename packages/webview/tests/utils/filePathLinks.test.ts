import { describe, it, expect } from "vitest";
import {
  detectFilePathToken,
  linkifyFilePathText,
  resolveFilePathMatch,
  stripFilePathLinks,
} from "../../src/utils/filePathLinks";

// specs/ui/file-path-links.md —— 纯识别函数

const code = (s: string) =>
  detectFilePathToken(s, { allowRelative: true, requireExtension: true });
const text = (s: string) =>
  detectFilePathToken(s, { allowRelative: false, requireExtension: false });

describe("detectFilePathToken — 行内代码通道（整串、相对/绝对、:N / :N-M）", () => {
  it("识别带行区间的相对路径", () => {
    expect(code("src/utils/format.ts:12-24")).toEqual({
      kind: "rel",
      path: "src/utils/format.ts",
      display: "src/utils/format.ts:12-24",
      startLine: 12,
      endLine: 24,
    });
  });

  it("识别单行号相对路径（endLine 落到 startLine）", () => {
    const m = code("src/format.ts:9");
    expect(m?.path).toBe("src/format.ts");
    expect(m?.startLine).toBe(9);
    expect(m?.endLine).toBe(9);
  });

  it("识别无行号的相对路径", () => {
    expect(code("src/main.ts")?.path).toBe("src/main.ts");
    expect(code("./main.ts")?.path).toBe("./main.ts");
    expect(code("../shared/x.ts")?.path).toBe("../shared/x.ts");
  });

  it("识别 POSIX/Windows 绝对路径（代码通道需带扩展名）", () => {
    expect(code("/home/u/repo/config.json")?.kind).toBe("posix");
    expect(code("/etc/nginx/nginx.conf")?.kind).toBe("posix");
    expect(code("C:\\proj\\src\\a.ts")?.kind).toBe("win");
    expect(code("C:/proj/src/a.ts:5")?.startLine).toBe(5);
  });

  it("拒绝非路径代码内容", () => {
    expect(code("var x = 1")).toBeNull(); // 空白/无斜杠
    expect(code("www.example.com")).toBeNull(); // 无斜杠
    expect(code("/foo")).toBeNull(); // 无扩展名 + 单级
    expect(code("/etc/hosts")).toBeNull(); // 代码通道要求扩展名
    expect(code("a.ts")).toBeNull(); // 无斜杠
    expect(code("node src/a.ts")).toBeNull(); // 多词整串不提取
    expect(code("https://example.com/a")).toBeNull(); // URL 由 URL 通道处理
    expect(code("[t](https://example.com)")).toBeNull(); // markdown 链接语法原文
    expect(code("~/dev/proj/a.ts")).toBeNull(); // ~/ 无 home 展开依据
  });

  it("剥离首尾标点后仍识别", () => {
    expect(code("(src/a.ts)")?.path).toBe("src/a.ts");
    expect(code("`src/a.ts")?.path).toBe("src/a.ts");
    expect(code("src/a.ts,")?.path).toBe("src/a.ts");
  });

  it("正文模式拒绝相对路径", () => {
    expect(text("src/main.ts")).toBeNull();
    expect(text("../../x.ts")).toBeNull();
  });
});

describe("detectFilePathToken — 正文纯文本通道（仅绝对）", () => {
  it("识别多级 POSIX 绝对路径（不要求扩展名）", () => {
    expect(text("/etc/hosts")?.kind).toBe("posix");
    expect(text("/home/u/repo/src/index.ts")?.kind).toBe("posix");
  });

  it("拒绝单级绝对路径 /foo 与相对形式", () => {
    expect(text("/foo")).toBeNull();
    expect(text("foo/bar.ts")).toBeNull();
  });

  it("识别 Windows 盘符与 file:/// 形式", () => {
    expect(text("C:\\proj\\src\\a.ts")?.kind).toBe("win");
    expect(text("C:/proj/x.ts")?.kind).toBe("win");
    expect(text("file:///home/u/a.ts")?.kind).toBe("file");
    expect(text("file:///C:/x/y.ts")?.kind).toBe("file");
  });

  it("~/ 形式：识别候选但不生成链接（返回 null）", () => {
    expect(text("~/dev/proj/tsconfig.json")).toBeNull();
    expect(text("~/x.ts")).toBeNull();
  });
});

describe("resolveFilePathMatch — 打开路径解析", () => {
  it("相对路径按 workdir 归并", () => {
    const m = code("src/utils/format.ts:12-24")!;
    expect(resolveFilePathMatch(m, "/home/u/repo")).toBe(
      "/home/u/repo/src/utils/format.ts",
    );
  });

  it("相对路径无 workdir → null（渲染层回退纯文本）", () => {
    expect(resolveFilePathMatch(code("src/main.ts")!, undefined)).toBeNull();
  });

  it("绝对路径原样返回；file:/// 剥离协议前缀", () => {
    expect(resolveFilePathMatch(text("/etc/hosts")!)).toBe("/etc/hosts");
    expect(resolveFilePathMatch(text("file:///home/u/a.ts")!)).toBe(
      "/home/u/a.ts",
    );
    expect(resolveFilePathMatch(text("C:\\proj\\a.ts")!)).toBe(
      "C:\\proj\\a.ts",
    );
  });
});

describe("linkifyFilePathText — 正文纯文本链接化", () => {
  it("将正文中的绝对路径转为链接，保留标点与相邻文本", () => {
    const html = linkifyFilePathText("参见 /home/u/x.ts 与 /tmp/b.ts。");
    expect(html).toContain(
      '<a href="#" class="file-path-link">/home/u/x.ts</a>',
    );
    expect(html).toContain('<a href="#" class="file-path-link">/tmp/b.ts</a>');
    expect(html).toContain("参见 ");
    expect(html).toContain(" 与 ");
    expect(html).toContain("。");
  });

  it("路径后紧贴中文文本只链接路径部分，其余保留", () => {
    const html = linkifyFilePathText("参见 /etc/hosts，然后看 /tmp/a.ts。");
    expect(html).toContain(
      '<a href="#" class="file-path-link">/etc/hosts</a>，然后看 ',
    );
    expect(html).toContain(
      '<a href="#" class="file-path-link">/tmp/a.ts</a>。',
    );
  });

  it("正文通道不吞 :N 行号后缀（整串保持普通文本）", () => {
    const html = linkifyFilePathText("见 /tmp/a.ts:12");
    expect(html).not.toContain("file-path-link");
    expect(html).toContain("见 /tmp/a.ts:12");
  });

  it("含 HTML 特殊字符的普通文本完整转义", () => {
    const html = linkifyFilePathText("a < b & c");
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).not.toContain("<b");
  });

  it("相对路径与 ~/ 不生成链接", () => {
    const html = linkifyFilePathText("改 src/main.ts 与 ~/x/y.ts 看看");
    expect(html).not.toContain("file-path-link");
  });

  it("无绝对路径时与输入等值（转义往返一致）", () => {
    const html = linkifyFilePathText("变量 x = 1 与 https://example.com/a");
    expect(html).toContain("变量 x = 1");
  });

  it("多链接同段文本都能生成", () => {
    const html = linkifyFilePathText("/a/x.ts /b/y.ts");
    expect(html.match(/class="file-path-link"/g)).toHaveLength(2);
  });
});

describe("stripFilePathLinks", () => {
  it("剥掉已生成的路径锚点（markdown 链接 label 内防嵌套）", () => {
    const inner = '说明 <a href="#" class="file-path-link">/tmp/bug.ts</a>';
    expect(stripFilePathLinks(inner)).toContain("说明 /tmp/bug.ts");
    expect(stripFilePathLinks(inner)).not.toContain("file-path-link");
  });
});
