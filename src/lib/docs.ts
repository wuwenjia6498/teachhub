import { cache as reactCache } from "react";
import { Redis } from "@upstash/redis";
import { unstable_cache, revalidatePath, revalidateTag } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Doc } from "@/types/doc";

/* 通过环境变量 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 自动初始化 */
const kv = Redis.fromEnv();

/** 文档元信息（不含正文，用于列表展示） */
export type DocMeta = Omit<Doc, "content">;

/** KV 键名：存储所有文档元信息数组 */
const INDEX_KEY = "docs:index";

/* 缓存标签常量，方便写入时一次性失效所有相关缓存 */
const CACHE_TAG_INDEX = "docs-index";

/* ==========================================================================
 * 内容压缩层
 * --------------------------------------------------------------------------
 * 为了减小 Upstash Redis 的存储 & 传输体积（HTML 内容压缩后一般只剩 15-25%），
 * 写入前用 gzip 压缩 content 字段，读取时按需解压。
 * 通过 "__gz__" 前缀标记压缩数据，保证向后兼容：旧文档未压缩也能正常读。
 * ========================================================================== */
const COMPRESS_PREFIX = "__gz__";

function compressContent(content: string): string {
  if (!content) return content;
  const gz = gzipSync(content, { level: 9 });
  return COMPRESS_PREFIX + gz.toString("base64");
}

function decompressContent(content: string | undefined | null): string {
  if (!content) return "";
  if (!content.startsWith(COMPRESS_PREFIX)) return content;
  try {
    const b64 = content.slice(COMPRESS_PREFIX.length);
    return gunzipSync(Buffer.from(b64, "base64")).toString("utf-8");
  } catch {
    /* 解压失败则退回原文，确保读取链路绝不抛错 */
    return content;
  }
}

/* ==========================================================================
 * 进程级内存 TTL 缓存
 * --------------------------------------------------------------------------
 * unstable_cache 在 dev 模式下可能失效；在 Vercel serverless 冷启动时也要重建。
 * 这里用一个模块级 Map 做毫秒级本地缓存（默认 60s TTL），同一进程内的重复请求
 * 几乎 0 开销。适合"内容低频变动、读极多"的教研文档场景。
 * ========================================================================== */
type CacheEntry<T> = { value: T; expireAt: number };
const memCache = new Map<string, CacheEntry<unknown>>();
const MEM_TTL_MS = 60_000; // 60 秒足以覆盖常见的连续点击/刷新

function memGet<T>(key: string): T | undefined {
  const hit = memCache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt < Date.now()) {
    memCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function memSet<T>(key: string, value: T, ttl = MEM_TTL_MS) {
  memCache.set(key, { value, expireAt: Date.now() + ttl });
}

function memInvalidate(prefix: string) {
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
}

/* ==========================================================================
 * 对外 API
 * ========================================================================== */

/**
 * 读取全部元信息列表；失败时返回空数组
 *
 * 缓存策略（2026-04 修订）：
 *   - 只保留 Next.js 的 unstable_cache（tag-based，revalidateTag 能**全局**失效）
 *   - **不再用**实例本地 memCache 缓存 index
 *     原因：memCache 是进程级 Map，实例 A 写后只清 A 的，实例 B 仍持旧数据
 *     60 秒；Vercel 多 warm 实例下 "编辑后 fetch 看不到新数据" 就是这来的。
 *     index 本身很小（几十条 meta），直接走 Redis 影响可忽略。
 *   - getDocById 保留 memCache，因为单文档内容大、修改频率低，跨实例一致性
 *     要求低（SSR 的 ISR 已是权威）。
 */
export const readDocsMeta = unstable_cache(
  async (): Promise<DocMeta[]> => {
    try {
      const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
      return index;
    } catch {
      return [];
    }
  },
  ["docs-index"],
  { tags: [CACHE_TAG_INDEX], revalidate: 3600 },
);

/** 按 id（时间戳）倒序排列的元信息列表 */
export async function readSortedDocsMeta(): Promise<DocMeta[]> {
  const docs = await readDocsMeta();
  return [...docs].sort((a, b) => Number(b.id) - Number(a.id));
}

/**
 * 根据 id 获取完整文档（含 content）；不存在时返回 null
 *
 * 缓存策略：
 * 1. React cache()：**同一次请求**内被多次调用时（如 generateMetadata + 页面组件）
 *    只真正执行一次，避免重复 IO。
 * 2. 进程内存 Map：跨请求的结果复用，60s TTL。
 *
 * 说明：没有用 Next.js 的 unstable_cache，因为它有 2MB/条 的上限，
 * 而教研文档含 base64 图片时单篇常常超过 2MB，包一层反而静默失败。
 * 页面级的 ISR (revalidate) 仍在，仍然能给 HTML 输出做静态缓存。
 */
export const getDocById = reactCache(async (id: string): Promise<Doc | null> => {
  const key = `doc:${id}`;
  const cached = memGet<Doc>(key);
  if (cached) return cached;

  try {
    const raw = await kv.get<Doc>(key);
    if (!raw) return null;
    const decoded: Doc = { ...raw, content: decompressContent(raw.content) };
    memSet(key, decoded);
    return decoded;
  } catch {
    return null;
  }
});

/**
 * 将新文档插入 KV：全文存 doc:{id}（content 压缩后存），元信息追加到索引头部。
 *
 * 【并发安全】读旧索引时**必须直读 Redis**，不能走 memCache / unstable_cache。
 * 否则在下列场景会触发 lost update：
 *   - 多 Vercel warm 实例同时收到上传请求，各自 memCache 持有不同快照
 *   - 本地 dev 和生产共用同一 Redis，两端交替上传（memCache 互不感知）
 * 代价是每次上传多一次 Redis GET（~30-80ms），而上传本就是低频操作，代价可忽略。
 * 读取路径（首页 / 详情页）仍然走缓存，性能不受影响。
 */
export async function prependDoc(doc: Doc): Promise<void> {
  const { content: _content, ...meta } = doc;

  /* 写入前基于 Redis 最新快照，避免被缓存的旧索引覆盖掉其它实例的写入 */
  const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
  const next = [meta, ...index];

  /* 压缩正文后再写 Redis，体积通常只剩 15-25%，网络传输更快 */
  const compressed: Doc = { ...doc, content: compressContent(doc.content) };

  await Promise.all([
    kv.set(`doc:${doc.id}`, compressed),
    kv.set(INDEX_KEY, next),
  ]);

  /* 失效所有相关缓存层：
   * - memCache[doc:{id}]：该实例本地读取时立即生效
   * - unstable_cache(tag=docs-index)：全局所有实例下次 readDocsMeta 时回源
   * - revalidatePath("/") + "/doc/{id}"：让 ISR 预渲染的静态 HTML 立刻失效 */
  memInvalidate(`doc:${doc.id}`);
  revalidateTag(CACHE_TAG_INDEX);
  revalidatePath("/");
  revalidatePath(`/doc/${doc.id}`);
}

/**
 * 仅替换已存在文档的 content（不改动 title/date/summary，也不动索引）
 * 用于批量迁移场景：把 HTML 中的 base64 图片外置后回写。
 * 写入时会自动 gzip 压缩；失败抛错由调用方处理。
 */
export async function updateDocContent(id: string, content: string): Promise<void> {
  const key = `doc:${id}`;
  const raw = await kv.get<Doc>(key);
  if (!raw) throw new Error(`doc ${id} not found`);

  const updated: Doc = { ...raw, content: compressContent(content) };
  await kv.set(key, updated);

  /* 本地缓存 + ISR 静态 HTML 都失效，下次读拿到最新 */
  memInvalidate(`doc:${id}`);
  revalidatePath(`/doc/${id}`);
}

/**
 * 更新文档的 title / date（分享日期与标题），不触碰正文 & summary。
 *
 * 需要同时更新两处：
 *   1. doc:{id}     —— 详情页读的是这个
 *   2. docs:index   —— 首页/搜索/管理列表读的是这个
 * 任一处没更新，就会出现"首页显示旧标题 / 详情页显示新标题"的错位。
 *
 * @throws 文档不存在时抛 `doc {id} not found`
 */
export async function updateDocMeta(
  id: string,
  patch: { title?: string; date?: string },
): Promise<DocMeta> {
  const key = `doc:${id}`;
  const raw = await kv.get<Doc>(key);
  if (!raw) throw new Error(`doc ${id} not found`);

  /* 只接收两个字段；其它字段保持原样，防止误写入 */
  const nextTitle = (patch.title ?? raw.title).trim();
  const nextDate = (patch.date ?? raw.date).trim();

  if (!nextTitle) throw new Error("title 不能为空");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
    throw new Error("date 必须是 YYYY-MM-DD 格式");
  }

  /* 更新 doc:{id}：content 是已压缩状态，原样保留 */
  const nextDoc: Doc = { ...raw, title: nextTitle, date: nextDate };
  await kv.set(key, nextDoc);

  /* 同步更新 docs:index 里对应条目 */
  const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
  const idx = index.findIndex((d) => d.id === id);
  if (idx >= 0) {
    index[idx] = {
      ...index[idx],
      title: nextTitle,
      date: nextDate,
    };
    await kv.set(INDEX_KEY, index);
  }

  /* 失效所有相关缓存：见 prependDoc 同名注释 */
  memInvalidate(`doc:${id}`);
  revalidateTag(CACHE_TAG_INDEX);
  revalidatePath("/");
  revalidatePath(`/doc/${id}`);

  const { content: _omit, ...metaOut } = nextDoc;
  return metaOut;
}

/**
 * 按 id 删除文档；成功返回 true，不存在返回 false。
 *
 * 同 prependDoc：**写入前直读 Redis 拿最新索引**，不走缓存。否则两端交替
 * 写入时会把别人刚插入的文档一起挤出索引，详见 prependDoc 注释。
 */
export async function deleteDoc(id: string): Promise<boolean> {
  const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
  const filtered = index.filter((d) => d.id !== id);

  if (filtered.length === index.length) return false;

  await Promise.all([
    kv.set(INDEX_KEY, filtered),
    kv.del(`doc:${id}`),
  ]);

  memInvalidate(`doc:${id}`);
  revalidateTag(CACHE_TAG_INDEX);
  revalidatePath("/");
  revalidatePath(`/doc/${id}`);
  return true;
}
