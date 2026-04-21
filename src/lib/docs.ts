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
 * 缓存策略说明（2026-04 二次修订）
 * --------------------------------------------------------------------------
 * 曾经这里有一个"进程级内存 Map"（memCache），用于给 getDocById 做 60s TTL
 * 的跨请求缓存。但在 Vercel 多 warm 实例环境下，这会引入严重的一致性问题：
 *
 *   实例 A 上触发写操作后，只能清掉 A 自己的 memCache；
 *   请求一旦随机落到实例 B，就可能读到 B 残留的旧数据（直到 B 的 TTL 过期）。
 *
 * 症状：管理员编辑完标题/上传完新文档，点进详情页看到的**还是旧的**，
 *       甚至需要过 60 秒才"忽然"变新。
 *
 * 结论：彻底移除 memCache。代价可接受——
 *   - 详情页走 ISR（revalidate=3600），99% 请求命中 CDN 静态 HTML，不碰 Redis
 *   - 只有 ISR 失效后的第一次 SSR 走 Redis，单次 GET ~30-80ms
 *   - 列表接口 /api/docs 仍由 unstable_cache + revalidateTag 兜底（全局一致）
 * ========================================================================== */

/**
 * 读取全部元信息列表；失败时返回空数组
 *
 * 缓存策略：只走 Next.js 的 unstable_cache（tag-based，revalidateTag 能**全局**
 * 失效）。不使用实例本地内存缓存——在 Vercel 多 warm 实例下，本地 Map 的失效
 * 无法跨实例，会导致"编辑后 fetch 看不到新数据"的幽灵 bug。
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

/**
 * 按"分享时间 date"倒序排列的元信息列表
 *
 * 排序规则：
 *   1. 主键：date（YYYY-MM-DD 字符串可直接字典序比较，等价于真实日期顺序）
 *   2. 次键：id（同一天分享多条时，后上传的在前），保证稳定可预测
 *
 * 历史：曾经仅按 id 倒序，但 id = 上传时间戳 ≠ 分享日期，
 * 偶尔会出现"后补录的旧分享"被错误地置顶。改用 date 主排序后，
 * 前台 / 管理端 / API 三处视角一致，避免前端二次排序引入的不一致风险。
 */
export async function readSortedDocsMeta(): Promise<DocMeta[]> {
  const docs = await readDocsMeta();
  return [...docs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return Number(b.id) - Number(a.id);
  });
}

/**
 * 根据 id 获取完整文档（含 content）；不存在时返回 null
 *
 * 缓存策略：
 *   - React cache()：**同一次请求**内被多次调用时（如 generateMetadata + 页面组件）
 *     只真正执行一次，避免重复 IO。这是请求作用域的，不跨请求、不跨实例，安全。
 *   - 跨请求缓存交给上层的 ISR（revalidate=3600）——页面级静态 HTML 才是真正的
 *     性能杠杆，Redis 直读只在 ISR 失效后发生。
 *
 * 为什么不用 Next.js 的 unstable_cache：它有 2MB/条 的上限，而教研文档含图片时
 * 单篇可能超过 2MB，包一层反而静默失败。externalized image 虽已让绝大多数文档
 * 变小，但保守起见继续让 ISR 做缓存层。
 */
export const getDocById = reactCache(async (id: string): Promise<Doc | null> => {
  try {
    const raw = await kv.get<Doc>(`doc:${id}`);
    if (!raw) return null;
    return { ...raw, content: decompressContent(raw.content) };
  } catch {
    return null;
  }
});

/**
 * 将新文档插入 KV：全文存 doc:{id}（content 压缩后存），元信息追加到索引头部。
 *
 * 【并发安全】读旧索引时**必须直读 Redis**，不能走 unstable_cache。
 * 否则多 Vercel warm 实例同时上传时会触发 lost update：两端各拿到一份旧索引，
 * 分别 append 自己的文档，后写者覆盖掉先写者。代价是每次上传多一次 Redis GET
 * (~30-80ms)，上传本就是低频操作，可忽略。
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
   * - unstable_cache(tag=docs-index)：全局所有实例下次 readDocsMeta 时回源
   * - revalidatePath("/") + "/doc/{id}"：让 ISR 预渲染的静态 HTML 立刻失效 */
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

  /* ISR 静态 HTML 失效，下次访问触发 SSR 拿到最新 */
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

  revalidateTag(CACHE_TAG_INDEX);
  revalidatePath("/");
  revalidatePath(`/doc/${id}`);
  return true;
}
