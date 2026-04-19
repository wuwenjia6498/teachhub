import { NextRequest, NextResponse } from "next/server";
import {
  getDocById,
  readDocsMeta,
  updateDocContent,
} from "@/lib/docs";
import { extractInlineImages } from "@/lib/imageStorage";

/**
 * POST /api/migrate/extract-images
 * --------------------------------------------------------------------------
 * 一次性迁移：把 Redis 里所有文档 HTML 中的 <img src="data:image/...;base64,...">
 * 抽出来上传到 Vercel Blob，替换成 CDN URL，再回写。
 *
 * 认证：Authorization: Bearer {ADMIN_PASSWORD}
 *
 * 查询参数：
 *   - dryRun=1：只扫描统计，不真正上传/回写（用于先估算影响面）
 *   - id=xxx：只处理指定 id 的文档（调试 / 重试单篇）
 *
 * 返回：每篇文档的处理结果（替换图片数、前后字符数、是否成功）
 */
export async function POST(req: NextRequest) {
  /* 鉴权 */
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlyId = url.searchParams.get("id");

  try {
    const metas = await readDocsMeta();
    const targets = onlyId ? metas.filter((m) => m.id === onlyId) : metas;

    const results: Array<{
      id: string;
      title: string;
      beforeKB: number;
      afterKB: number;
      replaced: number;
      failed: number;
      skipped?: boolean;
      error?: string;
    }> = [];

    /* 串行处理：避免几十篇文档同时并发上传把 Blob 带宽打满 */
    for (const meta of targets) {
      try {
        const doc = await getDocById(meta.id);
        if (!doc) {
          results.push({
            id: meta.id,
            title: meta.title,
            beforeKB: 0,
            afterKB: 0,
            replaced: 0,
            failed: 0,
            skipped: true,
            error: "doc not found",
          });
          continue;
        }

        const beforeBytes = Buffer.byteLength(doc.content, "utf8");

        /* 没有 base64 图就跳过，不打扰 Blob */
        if (!/src=["']data:image\//.test(doc.content)) {
          results.push({
            id: meta.id,
            title: meta.title,
            beforeKB: Math.round(beforeBytes / 1024),
            afterKB: Math.round(beforeBytes / 1024),
            replaced: 0,
            failed: 0,
            skipped: true,
          });
          continue;
        }

        const { html: newHtml, replaced, failed } = await extractInlineImages(
          doc.content,
        );
        const afterBytes = Buffer.byteLength(newHtml, "utf8");

        if (!dryRun && replaced > 0) {
          await updateDocContent(meta.id, newHtml);
        }

        results.push({
          id: meta.id,
          title: meta.title,
          beforeKB: Math.round(beforeBytes / 1024),
          afterKB: Math.round(afterBytes / 1024),
          replaced,
          failed,
        });
      } catch (err) {
        results.push({
          id: meta.id,
          title: meta.title,
          beforeKB: 0,
          afterKB: 0,
          replaced: 0,
          failed: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totalReplaced = results.reduce((a, r) => a + r.replaced, 0);
    const totalFailed = results.reduce((a, r) => a + r.failed, 0);
    const totalBeforeKB = results.reduce((a, r) => a + r.beforeKB, 0);
    const totalAfterKB = results.reduce((a, r) => a + r.afterKB, 0);

    return NextResponse.json({
      success: true,
      dryRun,
      processed: results.length,
      totalReplaced,
      totalFailed,
      totalBeforeKB,
      totalAfterKB,
      savedKB: Math.max(0, totalBeforeKB - totalAfterKB),
      results,
    });
  } catch (err) {
    console.error("图片迁移失败:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "迁移失败" },
      { status: 500 },
    );
  }
}

/**
 * 这个迁移可能跑得比较久（需要逐图上传到 Blob），
 * 明确声明长超时；在 Vercel 上默认 10 秒可能不够。
 */
export const maxDuration = 300; // 5 分钟
