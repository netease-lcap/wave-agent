/**
 * 最小 ZIP 写入器（deflate），只为把 Web 页产物打成运维平台那一端要的包。
 *
 * 为什么不引依赖：这个仓库的依赖是发布物的一部分，而这里需要的能力只有
 * 「把几个已知文件按相对路径写进一个 zip」——Node 自带 `zlib.crc32` 与
 * `deflateRawSync` 就够（`engines` 要求 Node >= 22，`crc32` 自 22.2 起可用），
 * 也就不必为一段构建脚本往 `package.json` 加 devDependency。
 *
 * 只实现收端（codechat `backend-ops/src/routes/remotePage.ts` 的 adm-zip 解析）
 * 会走到的部分：单层路径、deflate 或 store、UTF-8 文件名、无目录条目、无注释。
 * 不做 zip64（四个文件、几 MB，离 4 GB 上限很远）——真到那天再换实现。
 *
 * 时间戳固定为 1980-01-01：**同样的输入产出逐字节相同的 zip**，便于比对两次
 * 构建是否只差在内容上（收端解包后按对象存，时间戳不进线上）。
 */

import { crc32, deflateRawSync } from "node:zlib";

/** 1980-01-01 00:00:00，按 MS-DOS 打包格式（date = (年-1980)<<9 | 月<<5 | 日）。 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** 位 11：文件名是 UTF-8（本项目的名字都是 ASCII，写上不花钱）。 */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * 一个条目：deflate 压不动（压完更大）就退回 store —— 保证「压缩后不小于原文件」
 * 这种边界不会写出违法的 zip。
 */
function toEntry(name, data) {
  const deflated = deflateRawSync(data);
  const method = deflated.length < data.length ? METHOD_DEFLATE : METHOD_STORE;
  return {
    name,
    method,
    data: method === METHOD_DEFLATE ? deflated : data,
    crc: crc32(data),
    size: data.length,
  };
}

/**
 * 打成一个 zip：`files` 是 `{ path, data }`，`path` 用 `/` 分隔且必须是相对路径
 * （收端会把路径直接拼成对象 key）。
 *
 * @returns {Buffer} zip 的完整字节
 */
export function createZip(files) {
  const entries = files.map((f) => toEntry(f.path, f.data));
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(FLAG_UTF8, 6);
    localHeader.writeUInt16LE(entry.method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(entry.crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18); // compressed size
    localHeader.writeUInt32LE(entry.size, 22); // uncompressed size
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    chunks.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(entry.method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(entry.crc, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.size, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42); // offset of local header
    central.push(centralHeader, name);

    offset += localHeader.length + name.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}
