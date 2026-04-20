import { cache as reactCache } from "react";
import { Redis } from "@upstash/redis";
import { unstable_cache, revalidateTag } from "next/cache";
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

/** 读取全部元信息列表；失败时返回空数组（内存缓存 + Next.js tag 缓存双层） */
export const readDocsMeta = unstable_cache(
  async (): Promise<DocMeta[]> => {
    const cached = memGet<DocMeta[]>("index");
    if (cached) return cached;
    try {
      const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
      memSet("index", index);
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

/** 将新文档插入 KV：全文存 doc:{id}（content 压缩后存），元信息追加到索引头部 */
export async function prependDoc(doc: Doc): Promise<void> {
  const { content: _content, ...meta } = doc;

  /* 先读旧索引（尽量用缓存），再在头部追加 */
  const index = await readDocsMeta();
  const next = [meta, ...index];

  /* 压缩正文后再写 Redis，体积通常只剩 15-25%，网络传输更快 */
  const compressed: Doc = { ...doc, content: compressContent(doc.content) };

  await Promise.all([
    kv.set(`doc:${doc.id}`, compressed),
    kv.set(INDEX_KEY, next),
  ]);

  /* 同步失效内存缓存 + Next.js tag 缓存，保证下一次读取拿到最新数据 */
  memInvalidate("index");
  memInvalidate(`doc:${doc.id}`);
  revalidateTag(CACHE_TAG_INDEX);
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

  /* 本地与 Next.js 的缓存都失效，下次读拿到最新 */
  memInvalidate(`doc:${id}`);
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

  /* 失效所有相关缓存 */
  memInvalidate("index");
  memInvalidate(`doc:${id}`);
  revalidateTag(CACHE_TAG_INDEX);

  const { content: _omit, ...metaOut } = nextDoc;
  return metaOut;
}

/**
 * 仅更新文档的 summary 字段（AI 摘要），不触碰正文 / 标题 / 日期。
 *
 * 使用场景：上传流程里摘要生成耗时（Gemini 调用常 5-20s），
 * 为缩短用户等待，先把 summary 以空串入库 → 立刻返回成功，
 * 再由 Next.js 15 的 after() 在响应返回后继续调 Gemini，
 * 生成完成后回调本函数把 summary 补齐。
 *
 * 同 updateDocMeta 一样，要同时更新两处，否则首页 / 详情页会出现不一致：
 *   1. doc:{id}    —— 详情页读取的源
 *   2. docs:index  —— 首页 / 搜索用的元信息数组
 *
 * 调用者通常忽略抛错（后台任务失败不影响主流程，用户已拿到成功响应）。
 */
export async function updateDocSummary(id: string, summary: string): Promise<void> {
  const trimmed = (summary ?? "").trim();
  if (!trimmed) return; /* 摘要生成失败 → 保持原空值，下次上传同文档会再试 */

  const key = `doc:${id}`;
  const raw = await kv.get<Doc>(key);
  if (!raw) return; /* 文档已被删除，没必要写回 */

  /* 更新 doc:{id}：content 是已压缩状态，原样保留 */
  const nextDoc: Doc = { ...raw, summary: trimmed };
  await kv.set(key, nextDoc);

  /* 同步更新 docs:index 对应条目里的 summary */
  const index = (await kv.get<DocMeta[]>(INDEX_KEY)) ?? [];
  const idx = index.findIndex((d) => d.id === id);
  if (idx >= 0) {
    index[idx] = { ...index[idx], summary: trimmed };
    await kv.set(INDEX_KEY, index);
  }

  /* 失效缓存，首页 / 详情页下一次读取拿到新摘要 */
  memInvalidate("index");
  memInvalidate(`doc:${id}`);
  revalidateTag(CACHE_TAG_INDEX);
}

/** 按 id 删除文档；成功返回 true，不存在返回 false */
export async function deleteDoc(id: string): Promise<boolean> {
  const index = await readDocsMeta();
  const filtered = index.filter((d) => d.id !== id);

  if (filtered.length === index.length) return false;

  await Promise.all([
    kv.set(INDEX_KEY, filtered),
    kv.del(`doc:${id}`),
  ]);

  memInvalidate("index");
  memInvalidate(`doc:${id}`);
  revalidateTag(CACHE_TAG_INDEX);
  return true;
}
