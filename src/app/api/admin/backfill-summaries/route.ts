import { NextRequest, NextResponse } from "next/server";
import { backfillMissingSummaries } from "@/lib/summaries";

/* ============================================================================
 * Route Segment Config
 * ----------------------------------------------------------------------------
 * - nodejs：lib/summaries → lib/docs 依赖 @upstash/redis（Node API）
 * - maxDuration = 60：AI 单篇 2-5 秒，串行 10 篇保守 50 秒内完成。
 *   一次性处理不完的剩余由下一次 Cron 或再次手动触发兜底。
 * ========================================================================== */
export const runtime = "nodejs";
export const maxDuration = 60;

/* ============================================================================
 * POST /api/admin/backfill-summaries
 * ----------------------------------------------------------------------------
 * 用途：管理员手动批量补齐"summary 为空"的文档摘要。
 *
 * 请求体（可选）：{ apply?: boolean, limit?: number }
 *   - apply=false（默认）→ 仅 dryRun 列清单
 *   - apply=true         → 实际调 AI 生成并写回 Redis
 *   - limit              → 单次最多处理多少篇，默认 10
 *
 * 安全：仅带 admin_auth cookie 的登录管理员可用。
 * 与 Cron 的区别：无鉴权用 CRON_SECRET，走的不是 admin cookie，互不影响。
 * ========================================================================== */
export async function POST(req: NextRequest) {
  if (req.cookies.get("admin_auth")?.value !== "1") {
    return NextResponse.json({ error: "未授权，请先登录管理后台" }, { status: 401 });
  }

  let apply = false;
  let limit: number | undefined;
  try {
    const body = await req.json();
    apply = body?.apply === true;
    if (typeof body?.limit === "number") limit = body.limit;
  } catch {
    /* 空 body 即视为 dryRun */
  }

  try {
    const result = await backfillMissingSummaries({ apply, limit });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "批量补摘要失败";
    console.error("[admin/backfill-summaries] 失败:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
