import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { modFetch } from "../../src/mods/http.js";
import { MOD_LIMITS } from "../../src/types/mods.js";

/**
 * `$.http.fetch` 的宿主实现（spec「发 HTTP 请求」）。
 *
 * 这里起一个**真的本机 server**：白名单、重定向次数、Content-Length 拒绝、
 * 流式截断、超时全都在真连接上才有意义 —— mock 掉 `fetch` 就只剩自证的假流。
 */

let server: http.Server | undefined;

async function start(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<string> {
  server = http.createServer((req, res) => {
    // 客户端提前断开（截断、拒绝、超时）时 server 这边会拿到 EPIPE；它不该把
    // 测试打成失败。
    res.on("error", () => {});
    handler(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  const closing = server;
  server = undefined;
  if (!closing) return;
  closing.closeAllConnections();
  await new Promise<void>((resolve) => closing.close(() => resolve()));
});

describe("modFetch", () => {
  it("返回 status / ok / headers / text", async () => {
    const base = await start((_req, res) => {
      res.writeHead(201, { "x-kind": "ok" });
      res.end("hello");
    });

    const result = await modFetch(`${base}/a`);
    expect(result).toMatchObject({
      ok: true,
      status: 201,
      text: "hello",
      isTruncated: false,
    });
    expect(result.headers["x-kind"]).toBe("ok");
  });

  it("POST 把 body 发出去", async () => {
    const base = await start((req, res) => {
      let received = "";
      req.on("data", (chunk) => {
        received += String(chunk);
      });
      req.on("end", () => res.end(`got:${received}`));
    });

    const result = await modFetch(`${base}/echo`, {
      method: "POST",
      body: "ping",
    });
    expect(result.text).toBe("got:ping");
  });

  it("跟随重定向", async () => {
    let base = "";
    base = await start((req, res) => {
      if (req.url === "/final") {
        res.end("done");
        return;
      }
      res.writeHead(302, { location: "/final" });
      res.end();
    });

    await expect(modFetch(`${base}/start`)).resolves.toMatchObject({
      text: "done",
      status: 200,
    });
  });

  it("重定向超过 5 次就报错", async () => {
    let base = "";
    base = await start((_req, res) => {
      res.writeHead(302, { location: "/loop" });
      res.end();
    });

    await expect(modFetch(`${base}/loop`)).rejects.toThrow(
      new RegExp(`重定向超过 ${MOD_LIMITS.httpMaxRedirects} 次`),
    );
  });

  it("重定向落到白名单外就报错（否则 https 一跳就能到明文远端）", async () => {
    const base = await start((_req, res) => {
      res.writeHead(302, { location: "http://example.com/x" });
      res.end();
    });

    await expect(modFetch(`${base}/a`)).rejects.toThrow(/不允许的地址/);
  });

  it("只允许 https: 与本机回环的 http:", async () => {
    await expect(modFetch("http://example.com/x")).rejects.toThrow(
      /只允许 https:/,
    );
    await expect(modFetch("file:///etc/passwd")).rejects.toThrow(/只允许/);
    await expect(modFetch("ftp://example.com/x")).rejects.toThrow(/只允许/);
  });

  it("Content-Length 声明超限就直接报错，不静默截断", async () => {
    const base = await start((_req, res) => {
      res.writeHead(200, {
        "content-length": String(MOD_LIMITS.httpBodyChars + 1),
      });
      res.end();
    });

    await expect(modFetch(`${base}/declared`)).rejects.toThrow(/超过 \d+ 字节/);
  });

  it("响应体实际超限时截断并置 isTruncated", async () => {
    const base = await start((_req, res) => {
      // 不声明 content-length：走 chunked，这样只能靠读的时候数。
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("a".repeat(MOD_LIMITS.httpBodyChars + 1024));
    });

    const result = await modFetch(`${base}/big`);
    expect(result.isTruncated).toBe(true);
    expect(result.text.length).toBe(MOD_LIMITS.httpBodyChars);
  });

  it("超过 timeoutMs 报错", async () => {
    // 故意不响应：连接挂着，靠 timeout 收场。
    const base = await start(() => {});

    await expect(modFetch(`${base}/slow`, { timeoutMs: 100 })).rejects.toThrow(
      /超过 100 毫秒/,
    );
  });

  it("超时也覆盖读完 body 的阶段", async () => {
    const base = await start((_req, res) => {
      // 头发出来了、body 也不 end：卡在读流上，而不是等响应头。
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial");
    });

    await expect(modFetch(`${base}/half`, { timeoutMs: 100 })).rejects.toThrow(
      /超过 100 毫秒/,
    );
  });

  it("参数校验", async () => {
    await expect(modFetch(1)).rejects.toThrow(/需要一个 URL 字符串/);
    await expect(modFetch("http://127.0.0.1:1/x", "GET")).rejects.toThrow(
      /第二个参数必须是对象/,
    );
    await expect(
      modFetch("http://127.0.0.1:1/x", { method: "PO ST" }),
    ).rejects.toThrow(/method 不合法/);
    await expect(
      modFetch("http://127.0.0.1:1/x", {
        headers: { a: 1 as unknown as string },
      }),
    ).rejects.toThrow(/必须是字符串/);
    await expect(
      modFetch("http://127.0.0.1:1/x", { body: 1 as unknown as string }),
    ).rejects.toThrow(/body 必须是字符串/);
    await expect(
      modFetch("http://127.0.0.1:1/x", {
        body: "a".repeat(MOD_LIMITS.httpBodyChars + 1),
      }),
    ).rejects.toThrow(/超过 \d+ 上限/);
    await expect(
      modFetch("http://127.0.0.1:1/x", { timeoutMs: 0 }),
    ).rejects.toThrow(/timeoutMs 必须是正数/);
  });
});
