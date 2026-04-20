/**
 * 浏览器端的 sessionStorage 轻量缓存
 * --------------------------------------------------------------------------
 * - 仅在当前标签页会话有效，关闭标签即清空，无隐私压力
 * - 每条数据带 TTL 时间戳，过期自动失效
 * - 存取使用 try/catch 防御：隐私模式 / 禁用存储 时静默降级
 * - 用于缓存：首页文档列表、单篇文档全文、hover 预拉结果
 */

const PREFIX = "teachub:"; // 命名空间避免冲突

interface Entry<T> {
  v: T;
  e: number; // expireAt (ms)
}

/** 写入；ttlMs 默认为 10 分钟 */
export function cacheSet<T>(key: string, value: T, ttlMs = 10 * 60 * 1000) {
  if (typeof window === "undefined") return;
  try {
    const entry: Entry<T> = { v: value, e: Date.now() + ttlMs };
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* storage 可能已满或被禁用；忽略 */
  }
}

/** 读取；命中且未过期才返回 value，否则返回 null */
export function cacheGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || entry.e < Date.now()) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.v;
  } catch {
    return null;
  }
}

/** 清除某个 key */
export function cacheDel(key: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------------------
 * 文档专用便捷函数
 * -------------------------------------------------------------------------- */

/** 单篇文档的缓存 key */
export const docKey = (id: string) => `doc:${id}`;
/** 首页列表的缓存 key */
export const docListKey = "doc-list";

/**
 * 统一的写后缓存失效：任何会改变 Redis 文档数据的操作
 * （新增 / 编辑 / 删除）完成后都应调用本函数。
 * - 必然失效首页列表缓存（docs:index 已变）
 * - 传入 id 时同时失效该篇详情缓存（避免详情页读到旧 title/date/content）
 *
 * 好处：写路径多加一个就多一处 cacheDel，容易漏；集中到这里后，
 * 新增写接口的同学只需要 `invalidateDocCache(id)` 一行，不会忘。
 */
export function invalidateDocCache(id?: string) {
  cacheDel(docListKey);
  if (id) cacheDel(docKey(id));
}

/**
 * 预拉取并缓存一篇文档；返回 Promise 以便调用者等待。
 * - 如果已经有未过期缓存，直接 resolve 已有值，不发请求
 * - 同时记录一个内存 pending 表，避免重复发多次请求
 */
const pendingFetches = new Map<string, Promise<unknown>>();

export function prefetchDoc<T = unknown>(id: string): Promise<T | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  const cached = cacheGet<T>(docKey(id));
  if (cached) return Promise.resolve(cached);

  const existing = pendingFetches.get(id) as Promise<T | null> | undefined;
  if (existing) return existing;

  const p = fetch(`/api/docs/${id}`, { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .then((data) => {
      if (data) cacheSet(docKey(id), data);
      return data;
    })
    .catch(() => null)
    .finally(() => pendingFetches.delete(id));

  pendingFetches.set(id, p as Promise<unknown>);
  return p;
}
