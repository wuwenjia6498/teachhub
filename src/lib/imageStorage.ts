import { put, list, del } from "@vercel/blob";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

/**
 * 图片对象存储抽象层（当前实现：Vercel Blob）
 * --------------------------------------------------------------------------
 * 统一 uploadImage(buffer, mime) 接口，供以下两处复用：
 *   1. /api/upload           — 新文档上传时，拦截 mammoth 的 docx 内嵌图片
 *   2. /api/migrate/extract-images — 历史数据迁移时，扫 HTML 中的 base64 图片
 *
 * 特性：
 *   - 基于 SHA-256 的内容去重：同一张图在多篇文档里只真正存一次
 *   - 去重映射记录在 Upstash Redis 的 img:{hash} 键，避免每次都走 Blob head 请求
 *   - 换存储服务时（比如改七牛/阿里云）只需要改这一个文件
 */

const kv = Redis.fromEnv();

/** 文件扩展名映射表：mime → 后缀 */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tif",
};

/** 根据 mime 取扩展名；兜底用 mime 的 subtype，再兜底为 "bin" */
function extOf(mime: string): string {
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  const sub = mime.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "");
  return sub || "bin";
}

/**
 * 上传图片到 Vercel Blob；相同内容的图片只会真正上传一次
 * @returns 公开可访问的 HTTPS URL
 */
export async function uploadImage(
  buffer: Buffer | Uint8Array,
  mimeType: string,
): Promise<string> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  /* 用 SHA-256 的前 16 字节（32 个 hex 字符）作为文件名指纹，冲突概率可忽略 */
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  const ext = extOf(mimeType);
  const key = `images/${hash}.${ext}`;

  /* 先查去重映射：同一张图之前上传过就直接复用旧 URL */
  try {
    const existing = await kv.get<string>(`img:${hash}`);
    if (existing) return existing;
  } catch {
    /* Redis 读失败不阻断上传流程 */
  }

  /* 真正上传到 Vercel Blob；addRandomSuffix=false 让 key 与 hash 对应一致 */
  const { url } = await put(key, buf, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: false,
    /* allowOverwrite=true：内容相同，覆盖也是幂等的；避免并发时报冲突 */
    allowOverwrite: true,
  });

  /* 记录 hash → url 映射，下次再遇到同一张图直接命中 */
  try {
    await kv.set(`img:${hash}`, url);
  } catch {
    /* 写缓存失败不影响本次返回 */
  }

  return url;
}

/**
 * 从 HTML 中扫描所有 <img src="data:image/...;base64,..."> 并外置为 URL
 * 返回：新 HTML + 本次新上传的图片数量（用于迁移进度统计）
 */
export async function extractInlineImages(
  html: string,
): Promise<{ html: string; replaced: number; failed: number }> {
  /* 匹配 src="data:image/<subtype>;base64,<payload>"（非贪婪，兼容单双引号） */
  const re =
    /src=(["'])data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)\1/g;

  const tasks: Array<{
    full: string;
    mime: string;
    b64: string;
    quote: string;
  }> = [];

  for (const m of html.matchAll(re)) {
    tasks.push({ full: m[0], quote: m[1], mime: m[2], b64: m[3] });
  }

  if (tasks.length === 0) return { html, replaced: 0, failed: 0 };

  /* 并发上传，但用 map+Promise.all 不会阻塞太久；如文档图极多可分批 */
  let replaced = 0;
  let failed = 0;
  const replacements = await Promise.all(
    tasks.map(async (t) => {
      try {
        /* base64 可能含换行/空白（HTML 里极少见但规范允许），先剥离 */
        const clean = t.b64.replace(/\s+/g, "");
        const buf = Buffer.from(clean, "base64");
        const url = await uploadImage(buf, t.mime);
        replaced++;
        return { full: t.full, replacement: `src=${t.quote}${url}${t.quote}` };
      } catch (err) {
        failed++;
        console.error("图片上传失败，保留原 base64:", err);
        return null;
      }
    }),
  );

  /* 按"出现位置"顺序替换，避免多次替换破坏字符串偏移 */
  let out = html;
  for (const r of replacements) {
    if (!r) continue;
    out = out.replace(r.full, r.replacement);
  }

  return { html: out, replaced, failed };
}

/* ==========================================================================
 * 孤儿图清理相关
 * --------------------------------------------------------------------------
 * 背景：迁移 / 重复上传 / 文档更新时，Blob 里可能留下"没人引用"的图片。
 * 长期不清理会白白占用存储配额。这一段封装"列出 + 删除"的底层能力，
 * 具体的业务编排（读 Redis 收集引用、比对、鉴权）放在 API 路由里。
 * ========================================================================== */

/** 单张 Blob 图片的元信息 */
export interface BlobImageItem {
  /** 对象 key，如 "images/xxxxxxxx.png" */
  pathname: string;
  /** 公网可访问 URL */
  url: string;
  /** 字节数 */
  size: number;
  /** 上传时间 */
  uploadedAt: Date;
}

/**
 * 分页列出 Blob 里 images/ 前缀的全部文件
 * Vercel Blob 单次最多返回 1000 条，超出要用 cursor 翻页
 */
export async function listAllBlobImages(): Promise<BlobImageItem[]> {
  const all: BlobImageItem[] = [];
  let cursor: string | undefined = undefined;

  do {
    const page: {
      blobs: Array<{
        pathname: string;
        url: string;
        size: number;
        uploadedAt: Date;
      }>;
      cursor?: string;
      hasMore: boolean;
    } = await list({ prefix: "images/", cursor, limit: 1000 });

    for (const b of page.blobs) {
      all.push({
        pathname: b.pathname,
        url: b.url,
        size: b.size,
        uploadedAt: b.uploadedAt,
      });
    }

    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return all;
}

/**
 * 批量删除 Blob 图片；同步清除 Redis 里对应的 img:{hash} 去重映射
 * 否则下次遇到同内容图片会命中 "已失效 URL"，造成 404。
 */
export async function deleteBlobImages(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;

  /* Vercel Blob 的 del 支持批量 */
  await del(urls);

  /* 同步清理 Redis 里失效的 hash → url 映射 */
  const hashes = urls
    .map((u) => extractHashFromUrl(u))
    .filter((h): h is string => !!h);

  if (hashes.length > 0) {
    try {
      await Promise.all(hashes.map((h) => kv.del(`img:${h}`)));
    } catch (err) {
      /* 映射清理失败不阻塞整体流程，下次去重会自动覆盖 */
      console.error("清理 Redis img:{hash} 映射失败:", err);
    }
  }

  return urls.length;
}

/**
 * 从 Blob URL 提取 hash 片段
 * URL 形如 https://xxx.public.blob.vercel-storage.com/images/<32hex>.<ext>
 */
export function extractHashFromUrl(url: string): string | null {
  const m = url.match(/\/images\/([a-f0-9]{32})\./i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 从 HTML 字符串里抽出所有指向 Blob 的图片 URL
 * 用于统计"引用中"的图片，进而算出孤儿
 */
export function extractBlobUrlsFromHtml(html: string): string[] {
  if (!html) return [];
  /* 匹配 src="https://...blob.vercel-storage.com/images/xxx.ext"
     兼容单双引号；只匹配公开 blob 域名模式，避免误伤 */
  const re =
    /src=["'](https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/images\/[a-f0-9]{32}\.[a-z0-9]+)["']/gi;
  const out: string[] = [];
  for (const m of html.matchAll(re)) out.push(m[1]);
  return out;
}
