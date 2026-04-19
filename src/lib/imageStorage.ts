import { put } from "@vercel/blob";
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
