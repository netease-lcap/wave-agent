import { describe, it, expect } from "vitest";
import {
  detectFilePathToken,
  linkifyCodeBlockPaths,
  linkifyFilePathText,
  resolveFilePathMatch,
  stripFilePathLinks,
} from "../../src/utils/filePathLinks";

// specs/ui/file-path-links.md —— 纯识别函数
// 四条通道（行内代码 / 正文纯文本 / 围栏代码块 / bash 输出）共用同一套识别规则：
// 只识别绝对路径，且必须带点扩展名。正文通道另外不解析 `:N` 行号后缀。

const code = (s: string) => detectFilePathToken(s);
const text = (s: string) => detectFilePathToken(s, { lineSuffix: false });

describe("detectFilePathToken — 只识别绝对路径（四条通道同规则）", () => {
  it("识别带行区间的 POSIX 绝对路径", () => {
    expect(code("/home/u/repo/src/utils/format.ts:12-24")).toEqual({
      kind: "posix",
      path: "/home/u/repo/src/utils/format.ts",
      display: "/home/u/repo/src/utils/format.ts:12-24",
      startLine: 12,
      endLine: 24,
    });
  });

  it("识别单行号（endLine 落到 startLine）", () => {
    const m = code("/home/u/repo/src/format.ts:9");
    expect(m?.path).toBe("/home/u/repo/src/format.ts");
    expect(m?.startLine).toBe(9);
    expect(m?.endLine).toBe(9);
  });

  it("识别无行号的绝对路径", () => {
    expect(code("/home/u/repo/config.json")?.kind).toBe("posix");
    expect(code("/etc/nginx/nginx.conf")?.kind).toBe("posix");
    expect(code("C:\\proj\\src\\a.ts")?.kind).toBe("win");
    expect(code("C:/proj/src/a.ts:5")?.startLine).toBe(5);
  });

  it("拒绝相对路径（./ ../ 与裸相对形式一律不识别）", () => {
    expect(code("src/main.ts")).toBeNull();
    expect(code("src/utils/format.ts:12-24")).toBeNull();
    expect(code("./main.ts")).toBeNull();
    expect(code("./src/a.ts")).toBeNull();
    expect(code("../shared/x.ts")).toBeNull();
    expect(code("../sibling-repo/src/b.ts")).toBeNull();
    expect(code("../../x/y.ts")).toBeNull();
    expect(code("foo/bar.ts")).toBeNull();
  });

  it("识别含中文/非 ASCII 字符的绝对路径", () => {
    expect(code("C:\\Users\\张三\\下载\\报表.xlsx")?.kind).toBe("win");
    expect(
      code("C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html")?.kind,
    ).toBe("win");
    expect(code("/home/张三/项目/笔记.md")?.kind).toBe("posix");
    expect(code("C:/用户/目录/文件 名.txt")).toBeNull(); // 含空白仍不识别
  });

  it("拒绝无点扩展名的绝对路径与纯中文内容", () => {
    expect(code("/etc/hosts")).toBeNull();
    expect(code("/var/log/syslog")).toBeNull();
    expect(code("/usr/local/bin")).toBeNull();
    expect(code("C:\\Users\\张三\\下载")).toBeNull();
    expect(code("/张三/李四/")).toBeNull(); // 尾斜杠非段字符
    expect(code("请把报表放在这里")).toBeNull(); // 中文句子无斜杠
  });

  it("拒绝非路径代码内容", () => {
    expect(code("var x = 1")).toBeNull(); // 空白/无斜杠
    expect(code("www.example.com")).toBeNull(); // 无斜杠
    expect(code("/foo")).toBeNull(); // 单级 + 无扩展名
    expect(code("a.ts")).toBeNull(); // 无斜杠
    expect(code("node src/a.ts")).toBeNull(); // 多词整串不提取
    expect(code("https://example.com/a")).toBeNull(); // URL 由 URL 通道处理
    expect(code("[t](https://example.com)")).toBeNull(); // markdown 链接语法原文
    expect(code("~/dev/proj/a.ts")).toBeNull(); // ~/ 无 home 展开依据
  });

  it("剥离首尾标点后仍识别", () => {
    expect(code("(/home/u/a.ts)")?.path).toBe("/home/u/a.ts");
    expect(code("`/home/u/a.ts")?.path).toBe("/home/u/a.ts");
    expect(code("/home/u/a.ts,")?.path).toBe("/home/u/a.ts");
  });
});

describe("detectFilePathToken — 正文纯文本通道（仅绝对 + 要求扩展名）", () => {
  it("识别多级 POSIX 绝对路径", () => {
    expect(text("/home/u/repo/src/index.ts")?.kind).toBe("posix");
    expect(text("/etc/nginx/nginx.conf")?.kind).toBe("posix");
  });

  it("拒绝无扩展名的绝对路径", () => {
    expect(text("/etc/hosts")).toBeNull();
    expect(text("/var/log/syslog")).toBeNull();
    expect(text("/usr/local/bin")).toBeNull();
  });

  it("拒绝单级绝对路径 /foo 与相对形式", () => {
    expect(text("/foo")).toBeNull();
    expect(text("foo/bar.ts")).toBeNull();
    expect(text("src/main.ts")).toBeNull();
    expect(text("../../x.ts")).toBeNull();
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

  it("正文通道识别含中文文件名的绝对路径（需带 ASCII 扩展名收尾）", () => {
    expect(text("C:\\Users\\张三\\下载\\报表.xlsx")?.kind).toBe("win");
    expect(text("/home/张三/项目/笔记.md")?.kind).toBe("posix");
    expect(
      text("C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html")?.kind,
    ).toBe("win");
  });

  it("正文通道拒绝无扩展名的中文绝对路径与纯中文斜杠文本（防散文误判）", () => {
    expect(text("C:\\Users\\张三\\下载")).toBeNull(); // 中文路径但无扩展名
    expect(text("/home/张三/项目")).toBeNull(); // 目录级中文无扩展名
    expect(text("/请把报表放在/这里")).toBeNull(); // 中文散文斜杠形态
    expect(text("/etc/hosts文件")).toBeNull(); // 中文尾巴不被吞成路径
  });

  it("正文通道不解析 :N 行号后缀", () => {
    expect(text("/tmp/a.ts:12")).toBeNull(); // ':12' 使整串不匹配路径形态
  });
});

describe("resolveFilePathMatch — 打开路径解析", () => {
  it("绝对路径原样返回；file:/// 剥离协议前缀", () => {
    expect(resolveFilePathMatch(text("/home/u/a.ts")!)).toBe("/home/u/a.ts");
    expect(resolveFilePathMatch(text("file:///home/u/a.ts")!)).toBe(
      "/home/u/a.ts",
    );
    expect(resolveFilePathMatch(text("C:\\proj\\a.ts")!)).toBe(
      "C:\\proj\\a.ts",
    );
  });

  // specs/ui/file-path-links.md 场景 5 —— 发往宿主的路径必须是规范绝对路径
  it("路径中的 `..` 段纯词法折叠", () => {
    expect(resolveFilePathMatch(text("/home/u/proj/../x/a.ts")!)).toBe(
      "/home/u/x/a.ts",
    );
    expect(resolveFilePathMatch(text("/home/../../a/b.ts")!)).toBe("/a/b.ts");
  });

  it("Windows 盘符路径折叠后保留原有分隔符风格", () => {
    expect(resolveFilePathMatch(text("C:/a/../b/c.ts")!)).toBe("C:/b/c.ts");
    expect(resolveFilePathMatch(text("C:\\proj\\..\\a.ts")!)).toBe("C:\\a.ts");
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

  it("无扩展名的绝对路径不生成链接", () => {
    const html = linkifyFilePathText("参考 /etc/hosts 与 /var/log/syslog");
    expect(html).not.toContain("file-path-link");
    expect(html).toContain("/etc/hosts");
    expect(html).toContain("/var/log/syslog");
  });

  it("路径后紧贴中文文本只链接路径部分，其余保留", () => {
    const html = linkifyFilePathText("参见 /tmp/a.ts，然后看 /tmp/b.ts。");
    expect(html).toContain(
      '<a href="#" class="file-path-link">/tmp/a.ts</a>，然后看 ',
    );
    expect(html).toContain(
      '<a href="#" class="file-path-link">/tmp/b.ts</a>。',
    );
  });

  it("正文含中文文件名的绝对路径渲染为链接，中文文件名完整保留", () => {
    const html = linkifyFilePathText(
      "完整路径是 C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html，在下载目录里。",
    );
    expect(html).toContain(
      '<a href="#" class="file-path-link">C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html</a>，在下载目录里。',
    );
  });

  it("正文含 POSIX 中文路径同样链接，无扩展名的中文绝对路径保持普通文本", () => {
    const linked = linkifyFilePathText("参考 /home/张三/项目/笔记.md 的实现");
    expect(linked).toContain(
      '<a href="#" class="file-path-link">/home/张三/项目/笔记.md</a>',
    );
    const plain = linkifyFilePathText("放在 /home/张三/项目 目录下");
    expect(plain).not.toContain("file-path-link");
    expect(plain).toContain("/home/张三/项目");
  });

  it("中文散文句子不产生任何链接", () => {
    const html = linkifyFilePathText("请把报表放在这里，谢谢。");
    expect(html).not.toContain("file-path-link");
    expect(html).toContain("请把报表放在这里，谢谢。");
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
    const html = linkifyFilePathText(
      "改 src/main.ts 与 ./src/a.ts 与 ~/x/y.ts 看看",
    );
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

describe("linkifyCodeBlockPaths — 围栏代码块链接化", () => {
  const posix = "/home/u/repo/docs/public/screenshots/x.webp";
  const win = "C:\\Users\\u\\proj\\a.webp";

  it("逐 token 识别绝对路径，换行与缩进原样保留", () => {
    const html = linkifyCodeBlockPaths(`  ${win}\n\t${posix}\n`);
    expect(html).toContain(`  <a href="#" class="file-path-link">${win}</a>`);
    expect(html).toContain(`\t<a href="#" class="file-path-link">${posix}</a>`);
    expect(html).toContain("\n");
  });

  it("剥离首尾引号与标点，引号留在链接外", () => {
    const html = linkifyCodeBlockPaths('const p = "/home/u/proj/src/a.ts";');
    expect(html).toContain(
      'const p = &quot;<a href="#" class="file-path-link">/home/u/proj/src/a.ts</a>&quot;;',
    );
  });

  it("解析 :N / :N-M 行号后缀（整串作为显示文本）", () => {
    const html = linkifyCodeBlockPaths("/home/u/proj/src/format.ts:12-24");
    expect(html).toContain(
      '<a href="#" class="file-path-link">/home/u/proj/src/format.ts:12-24</a>',
    );
  });

  it("相对路径保持代码原文，不生成链接", () => {
    const rel = "docs/public/screenshots/x.webp";
    expect(linkifyCodeBlockPaths(rel)).toBe(rel);
    const dotted = "./dist/a.js";
    expect(linkifyCodeBlockPaths(dotted)).toBe(dotted);
    const html = linkifyCodeBlockPaths('const p = "src/utils/a.ts";');
    expect(html).not.toContain("file-path-link");
  });

  it("非路径内容（命令/变量/URL/无扩展名）不生成链接且完整转义", () => {
    const html = linkifyCodeBlockPaths(
      "npm run build\nvar x = 1;\nhttps://example.com/a/b\n/usr/local/bin\n<div>&</div>",
    );
    expect(html).not.toContain("file-path-link");
    expect(html).toContain("npm run build");
    expect(html).toContain("/usr/local/bin");
    expect(html).toContain("&lt;div&gt;&amp;&lt;/div&gt;");
  });
});

describe("stripFilePathLinks", () => {
  it("剥掉已生成的路径锚点（markdown 链接 label 内防嵌套）", () => {
    const inner = '说明 <a href="#" class="file-path-link">/tmp/bug.ts</a>';
    expect(stripFilePathLinks(inner)).toContain("说明 /tmp/bug.ts");
    expect(stripFilePathLinks(inner)).not.toContain("file-path-link");
  });
});

// ---- 远控页那一档：只把图片路径变成可点入口 -------------------------------
// spec remote/remote-web.md「点消息里的图片路径看原图」：页面上没有编辑器也没有
// 文件面板，文本路径链上去只是「点了没反应」，所以那一档只放行图片扩展名。
// 扩展名在这里是**路由提示**，宿主还会按解码出的真实容器再判一次。
describe("图片模式（远控页只链图片）", () => {
  it("images 模式放行图片、不放行其它文件", () => {
    const html = linkifyFilePathText(
      "/tmp/shots/before.png /tmp/shots/report.md",
      "images",
    );
    expect(html).toContain('class="file-path-link">/tmp/shots/before.png</a>');
    expect(html).not.toContain("/tmp/shots/report.md</a>");
    // 不放行的路径仍然原文显示，只是不可点。
    expect(html).toContain("/tmp/shots/report.md");
  });

  it("扩展名大小写不敏感（截图工具常写 .PNG）", () => {
    expect(linkifyFilePathText("/tmp/shots/a.PNG", "images")).toContain(
      "file-path-link",
    );
    expect(linkifyFilePathText("/tmp/shots/a.WebP", "images")).toContain(
      "file-path-link",
    );
  });

  it("all 模式两种都链（其它宿主的行为不变）", () => {
    const html = linkifyFilePathText(
      "/tmp/shots/before.png /tmp/shots/report.md",
      "all",
    );
    expect(html).toContain("before.png</a>");
    expect(html).toContain("report.md</a>");
  });

  it("off 模式整段原样转义，不生成任何链接", () => {
    const html = linkifyFilePathText("/tmp/shots/a.png <b>", "off");
    expect(html).not.toContain("file-path-link");
    expect(html).toContain("/tmp/shots/a.png");
    expect(html).toContain("&lt;b&gt;");
  });

  it("围栏代码块通道同规则", () => {
    const html = linkifyCodeBlockPaths(
      '"/tmp/shots/a.png"\n/tmp/shots/b.ts',
      "images",
    );
    expect(html).toContain('class="file-path-link">/tmp/shots/a.png</a>');
    expect(html).not.toContain("/tmp/shots/b.ts</a>");
  });

  it("行内代码通道同规则", () => {
    expect(linkifyCodeBlockPaths("/tmp/shots/a.jpeg", "images")).toContain(
      "file-path-link",
    );
    expect(linkifyCodeBlockPaths("/tmp/shots/a.json", "images")).not.toContain(
      "file-path-link",
    );
  });
});
