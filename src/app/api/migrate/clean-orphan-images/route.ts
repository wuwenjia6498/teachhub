import { NextRequest, NextResponse } from "next/server";
import { getDocById, readDocsMeta } from "@/lib/docs";
import {
  deleteBlobImages,
  extractBlobUrlsFromHtml,
  listAllBlobImages,
} from "@/lib/imageStorage";

/**
 * POST /api/migrate/clean-orphan-images
 * --------------------------------------------------------------------------
 * 扫 Vercel Blob 里 images/ 下的所有图片，跟 Redis 里所有 doc 的 HTML 内容做对比，
 * 找出"没有任何文档引用"的孤儿图。
 *
 * 场景：
 *   - 迁移时多跑了几次（历史数据有同 hash 去重其实不会重复，这里防患未然）
 *   - 用户删除文档但没触发图片级联清理（当前 deleteDoc 只删文档不删图）
 *   - 文档被更新/替换，老图片变成无引用
 *
 * 认证：Authorization: Bearer {ADMIN_PASSWORD}
 *
 * 查询参数：
 *   - dryRun=1：只列出孤儿，不真正删除（推荐先跑一次肉眼检查）
 *   - 不带 dryRun：真正删除 Blob 文件 + 清理 Redis 里对应的 img:{hash} 映射
 *
 * 返回：
 *   {
 *     dryRun, totalInBlob, totalReferenced, orphanCount,
 *     orphanSizeKB, deleted, orphans: [{ url, sizeKB, uploadedAt }]
 *   }
 */
export async function POST(req: NextRequest) {
  /* 鉴权 */
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    /* Step 1: 列出 Blob 里所有图片 */
    const allBlobs = await listAllBlobImages();

    /* Step 2: 读所有文档，收集引用的 URL（串行读以规避 Upstash 并发限流） */
    const metas = await readDocsMeta();
    const referenced = new Set<string>();

    for (const meta of metas) {
      const doc = await getDocById(meta.id);
      if (!doc?.content) continue;
      for (const u of extractBlobUrlsFromHtml(doc.content)) {
        referenced.add(u);
      }
    }

    /* Step 3: 差集 = 孤儿 */
    const orphans = allBlobs.filter((b) => !referenced.has(b.url));

    const orphanSizeBytes = orphans.reduce((a, o) => a + o.size, 0);

    /* Step 4: 非 dryRun 时批量删除 */
    let deleted = 0;
    if (!dryRun && orphans.length > 0) {
      deleted = await deleteBlobImages(orphans.map((o) => o.url));
    }

    return NextResponse.json({
      success: true,
      dryRun,
      totalInBlob: allBlobs.length,
      totalReferenced: referenced.size,
      orphanCount: orphans.length,
      orphanSizeKB: Math.round(orphanSizeBytes / 1024),
      deleted,
      /* 详情：孤儿列表（截断 100 条避免返回过大） */
      orphans: orphans.slice(0, 100).map((o) => ({
        url: o.url,
        pathname: o.pathname,
        sizeKB: Math.round(o.size / 1024),
        uploadedAt: o.uploadedAt,
      })),
      truncated: orphans.length > 100,
    });
  } catch (err) {
    console.error("孤儿图清理失败:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "清理失败" },
      { status: 500 },
    );
  }
}

/* 列 Blob + 逐篇读 Redis 可能需要几十秒，明确声明长超时 */
export const maxDuration = 300;
