import {
  DB_NAME,
  DB_VERSION,
  HANDS_STORE,
  STATS_STORE,
  STATS_KEY,
  STORES,
} from './schema';
import type { StoredHand } from './schema';

/**
 * IndexedDB 适配器。**全项目唯一允许出现 `indexedDB` 的文件**
 * （由 src/session/architecture.test.ts 的守卫盯着）。
 *
 * 刻意做薄：这里没有任何判断、排序、聚合或字段推导——那些全在 schema.ts、
 * stats.ts、query.ts 里，是纯函数，有测试。留在这个文件里的只有"把
 * IDBRequest 的回调包成 Promise"这一件事，以及打开数据库时按 STORES 建表。
 * 本项目不引 fake-indexeddb：那类假实现测出来的多半是假实现自己的行为，
 * 而真正会出问题的地方（版本升级、配额、隐私模式）它一个也复现不了。
 * 这一层由浏览器验收覆盖。
 *
 * **可用性不是前提。** 隐私模式、被禁用的存储、配额耗尽，都会让这里失败。
 * 失败一律向上抛，由调用方降级——牌局不依赖数据库，存不进去也必须能继续打。
 */

/** 环境是否有 IndexedDB。SSR / 老浏览器 / 某些隐私模式下没有 */
export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // 某些浏览器在禁用存储时，连读 `indexedDB` 这个属性都会抛 SecurityError
    return false;
  }
}

/** 把一个 IDBRequest 包成 Promise */
function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * 打开数据库。同一次会话内只真正打开一次，之后复用同一个 Promise。
 *
 * 失败时把缓存清掉：否则一次瞬时失败（比如首次打开时用户正好拒绝了存储权限）
 * 会被永久缓存，后面每次调用都拿到同一个失败的 Promise，重试永远不可能成功。
 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;
  if (!isStorageAvailable()) {
    return Promise.reject(new Error('此环境不支持 IndexedDB'));
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      // 只建 store 与索引，**不在这里遍历数据做值层面的迁移**：
      // onupgradeneeded 的事务会阻塞整个打开流程，在里面扫全表会让应用启动时
      // 卡住不定长的时间。值的版本升级在读出来之后按 schemaVersion 现场处理。
      for (const store of STORES) {
        const os = db.objectStoreNames.contains(store.name)
          ? req.transaction!.objectStore(store.name)
          : db.createObjectStore(store.name, { keyPath: store.keyPath });
        for (const idx of store.indexes) {
          if (!os.indexNames.contains(idx.name)) {
            os.createIndex(idx.name, idx.keyPath, { multiEntry: idx.multiEntry ?? false });
          }
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // 另一个标签页触发了更高版本的升级：让出连接，否则那边会一直卡在
      // onblocked。本页之后的读写会失败并走降级路径，这是对的——此时页面上
      // 跑的是旧代码。
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('打开 IndexedDB 失败'));
    };

    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB 被另一个标签页占住，无法升级'));
    };
  });

  return dbPromise.catch(err => {
    dbPromise = null;
    throw err;
  });
}

/** 关闭并忘掉当前连接。测试与「重置数据」用 */
export async function closeDb(): Promise<void> {
  if (dbPromise === null) return;
  const p = dbPromise;
  dbPromise = null;
  try {
    (await p).close();
  } catch {
    // 打开本来就失败过，没有连接可关
  }
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

export async function putHand(hand: StoredHand): Promise<void> {
  const db = await openDb();
  await promisify(tx(db, HANDS_STORE, 'readwrite').put(hand));
}

export async function getHand(id: string): Promise<StoredHand | undefined> {
  const db = await openDb();
  return promisify<StoredHand | undefined>(tx(db, HANDS_STORE, 'readonly').get(id));
}

export async function allHands(): Promise<StoredHand[]> {
  const db = await openDb();
  return promisify<StoredHand[]>(tx(db, HANDS_STORE, 'readonly').getAll());
}

export async function countHands(): Promise<number> {
  const db = await openDb();
  return promisify<number>(tx(db, HANDS_STORE, 'readonly').count());
}

/**
 * 按某个索引取一页，倒序。
 *
 * 用游标而不是 `getAll()` 之后再排序：历史页默认按 worstEvLoss 倒序，
 * 一万手全取出来再排是把整个库读进内存。游标 'prev' 方向由 IndexedDB
 * 自己走索引，只读到需要的那几条。
 */
export async function pageByIndex(
  indexName: string,
  opts: { limit: number; offset?: number; direction?: IDBCursorDirection } = { limit: 50 },
): Promise<StoredHand[]> {
  const db = await openDb();
  const index = tx(db, HANDS_STORE, 'readonly').index(indexName);
  const limit = opts.limit;
  const offset = opts.offset ?? 0;
  const direction = opts.direction ?? 'prev';

  return new Promise<StoredHand[]>((resolve, reject) => {
    const out: StoredHand[] = [];
    let skipped = false;
    const req = index.openCursor(null, direction);
    req.onerror = () => reject(req.error ?? new Error('游标失败'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor === null) {
        resolve(out);
        return;
      }
      // advance 只能调一次且参数必须 > 0，所以 offset 为 0 时不能调
      if (!skipped && offset > 0) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      skipped = true;
      out.push(cursor.value as StoredHand);
      if (out.length >= limit) {
        resolve(out);
        return;
      }
      cursor.continue();
    };
  });
}

export async function getStats<T>(): Promise<T | undefined> {
  const db = await openDb();
  const doc = await promisify<{ key: string; value: T } | undefined>(
    tx(db, STATS_STORE, 'readonly').get(STATS_KEY),
  );
  return doc?.value;
}

export async function putStats<T>(value: T): Promise<void> {
  const db = await openDb();
  await promisify(tx(db, STATS_STORE, 'readwrite').put({ key: STATS_KEY, value }));
}

/** 清空两个 store。「重置数据」用，不删库——删库要等所有连接关闭，容易卡住 */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  const t = db.transaction([HANDS_STORE, STATS_STORE], 'readwrite');
  await Promise.all([
    promisify(t.objectStore(HANDS_STORE).clear()),
    promisify(t.objectStore(STATS_STORE).clear()),
  ]);
}
