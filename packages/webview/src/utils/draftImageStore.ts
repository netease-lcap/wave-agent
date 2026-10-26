/**
 * 未发送的粘贴图片存在这里：webview 侧的 IndexedDB，按会话分键。
 *
 * 为什么不跟草稿文本一起存：粘贴图片只能以 data URL 待在输入框的标签节点上，
 * 而设置页、插件市场、创作集、会话看板都会整页顶替对话区，把输入框连同标签
 * 一起卸载。宿主保存的草稿只是一段字符串、每次按键上报一次，把 base64 写进去
 * 等于每次输入都传 MB 级数据，所以图片走本地存储，草稿文本里只留
 * `[@image:<id>]` 标记（spec ui/image-pasting.md「用户故事：草稿里的图片」）。
 *
 * 所有读写失败都静默吞掉：这份存储只是便利，缺了它输入框照样能粘贴和发送。
 */
const DB_NAME = "wave-webview-drafts";
const DB_VERSION = 1;
const STORE_NAME = "draftImages";
const SCOPE_INDEX = "byScope";

/** 单会话最多保留的草稿图片张数；超出按创建时间淘汰最旧的。 */
export const MAX_DRAFT_IMAGES_PER_SCOPE = 20;

export interface DraftImageRecord {
  /** 主键：`<scopeKey>:<id>`（IndexedDB 的 keyPath）。 */
  key: string;
  scopeKey: string;
  /** 草稿标记里用的 id（`[@image:<id>]`），同一张图跨多次序列化保持不变。 */
  id: string;
  /** data URL，发送时就是它。 */
  dataUrl: string;
  mimeType: string;
  /** 标签可见名（`图片 1`）；发送时作为附件名。 */
  filename: string;
  createdAt: number;
}

/**
 * 会话键：与会话一一对应，新对话按 pane 分。与宿主给 `inputDrafts` 分键的
 * 口径一致（`session:<id>` / `new:<paneId>`）。
 */
export const draftImageScopeKey = (
  sessionId?: string,
  paneId?: string,
): string =>
  sessionId ? `session:${sessionId}` : `new:${paneId ?? "default"}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** 打不开（无 IndexedDB、隐私模式、库被锁）就返回 null，调用方一律当空处理。 */
const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;
      const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex(SCOPE_INDEX, "scopeKey", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
};

const readScope = (
  db: IDBDatabase,
  scopeKey: string,
): Promise<DraftImageRecord[]> =>
  new Promise((resolve) => {
    try {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .index(SCOPE_INDEX)
        .getAll(scopeKey);
      request.onsuccess = () =>
        resolve((request.result as DraftImageRecord[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

/**
 * 用这次草稿里的图片覆盖该会话的记录：不在 `records` 里的（用户删掉了标签）
 * 顺手清掉，超过单会话上限的按创建时间淘汰最旧的。
 *
 * `keepIds` 是「这轮还不能提交、但也不该删」的 id：回填时图片标签先出现、
 * 字节过一会儿才从存储里取回，这中间触发的序列化不能把它的记录抹掉。
 */
export const saveDraftImages = async (
  scopeKey: string,
  records: readonly DraftImageRecord[],
  keepIds: readonly string[] = [],
): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const existing = await readScope(db, scopeKey);
  const keepIdSet = new Set([...records.map((item) => item.id), ...keepIds]);

  const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const overflow = ordered.slice(
    0,
    Math.max(0, ordered.length - MAX_DRAFT_IMAGES_PER_SCOPE),
  );
  const overflowKeys = new Set(overflow.map((item) => item.key));

  const writable = records.filter((item) => !overflowKeys.has(item.key));
  const droppedKeys = existing
    .filter((item) => !keepIdSet.has(item.id) || overflowKeys.has(item.key))
    .map((item) => item.key);

  try {
    await new Promise<void>((resolve) => {
      const store = db
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME);
      writable.forEach((item) => store.put(item));
      droppedKeys.forEach((key) => store.delete(key));
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => resolve();
      store.transaction.onabort = () => resolve();
    });
  } catch {
    // 配额满 / 库被关：草稿图片只是便利，静默放弃这一次写入。
  }
};

/** 该会话当前保存的图片，按 id 索引。打不开存储时是一张空表。 */
export const loadDraftImages = async (
  scopeKey: string,
): Promise<Map<string, DraftImageRecord>> => {
  const db = await openDb();
  if (!db) return new Map();
  const records = await readScope(db, scopeKey);
  return new Map(records.map((item) => [item.id, item]));
};

/** 清掉一个会话的全部草稿图片（发送后清空输入框时调用）。 */
export const clearDraftImages = async (scopeKey: string): Promise<void> => {
  await saveDraftImages(scopeKey, [], []);
};
