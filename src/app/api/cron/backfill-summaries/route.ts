import { NextRequest, NextResponse } from "next/server";
import { backfillMissingSummaries } from "@/lib/summaries";

/* ============================================================================
 * Route Segment Config
 * ----------------------------------------------------------------------------
 * - nodejs：依赖 @upstash/redis
 * - maxDuration = 60：为 AI 串行生成留足时间
 * - dynamic = "force-dynamic"：Cron 每次都要真跑，禁止任何缓存
 * ========================================================================== */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ============================================================================
 * GET /api/cron/backfill-summaries
 * ----------------------------------------------------------------------------
 * Vercel Cron 入口。按 vercel.json 的 schedule 定时触发。
 *
 * 鉴权：Vercel Cron 触发时会自动带 Authorization: Bearer ${CRON_SECRET}，
 *       这里只放行带正确密钥的请求，避免被公网扫到 URL 就能滥用。
 *       若项目未设置 CRON_SECRET，Vercel Dashboard 在开启 Cron 时会自动创建。
 *       本地调试可临时在 .env.local 里手动设置。
 *
 * 行为：
 *   - 直接 apply=true（Cron 的目的就是兜底修复，不需要 dryRun）
 *   - limit=10：Hobby 计划 60 秒超时里能稳定处理 10 篇。漏得更多？
 *     下一次 Cron 自然会继续补齐，最终一致。
 *
 * 返回：和 admin 入口一致的 BackfillResult，方便在 Vercel Logs 里直观看到进度。
 * ========================================================================== */
export async function GET(req: NextRequest) {
  /* 1. 鉴权：只允许 Vercel Cron 或带正确密钥的人调用 */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置，拒绝执行（请在 Vercel 项目环境变量里设置）" },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  /* 2. 执行补齐 */
  try {
    const result = await backfillMissingSummaries({ apply: true, limit: 10 });
    console.log("[cron/backfill-summaries] 执行结果:", JSON.stringify(result));
    return NextResponse.json({
      triggeredAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cron 执行失败";
    console.error("[cron/backfill-summaries] 失败:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
