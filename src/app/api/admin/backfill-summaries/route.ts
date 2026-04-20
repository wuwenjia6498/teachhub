import { NextRequest, NextResponse } from "next/server";
import { readDocsMeta, getDocById, updateDocSummary } from "@/lib/docs";

/* ============================================================================
 * Route Segment Config
 * ----------------------------------------------------------------------------
 * - nodejs：需要 @upstash/redis 客户端（Node API）
 * - maxDuration = 60：AI 摘要一般 2-5 秒/篇，串行跑 10-15 篇没问题。
 *   如果漏的多于 15 篇，分多次调用即可（已有摘要不会重复处理）。
 * ========================================================================== */
export const runtime = "nodejs";
export const maxDuration = 60;

const AIHUBMIX_API_URL = "https://aihubmix.com/v1/chat/completions";
const AIHUBMIX_MODEL = "gemini-2.5-flash";

/**
 * 调用 AIHUBMIX Gemini 生成文档摘要。
 * 与 /api/upload 里的同名函数保持一致的 prompt，结果风格统一。
 * 失败时抛错（而不是返回空串），让调用方能在结果里看到具体失败原因。
 */
async function generateSummary(plainText: string): Promise<string> {
  const apiKey = process.env.AIHUBMIX_API_KEY;
  if (!apiKey) throw new Error("AIHUBMIX_API_KEY 未配置");

  const res = await fetch(AIHUBMIX_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AIHUBMIX_MODEL,
      messages: [
        {
          role: "system",
          content:
            '你是文档摘要助手。请以"本次分享"开头，用一两句话概括以下文档的核心内容与要点，不超过80字，语言简洁专业。不要输出任何思考过程，直接给出摘要。',
        },
        { role: "user", content: plainText.slice(0, 4000) },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`aihubmix ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = (data?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) throw new Error("AI 返回内容为空");
  return content;
}

function extractPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/* ============================================================================
 * POST /api/admin/backfill-summaries
 * ----------------------------------------------------------------------------
 * 用途：补齐 Redis 中所有 `summary` 为空的文档的 AI 摘要。
 * 适用场景：
 *   - /api/upload 里的 after() 因 serverless worker 被回收而静默失败
 *   - aihubmix 偶发超时 / 限流
 *   - 之前批量导入的老文档没来得及生成摘要
 *
 * 请求体（可选）：
 *   { apply?: boolean }
 *     - 默认 apply=false → dryRun，只列出有多少篇待补，不实际调用 AI
 *     - apply=true       → 串行调 AI 生成并写回 Redis
 *
 * 返回：
 *   dryRun：{ mode, pendingCount, pending: [{id,title,date}] }
 *   apply ：{ mode, total, okCount, failCount, results: [...] }
 *
 * 安全：仅 admin cookie 可用。
 * ========================================================================== */
export async function POST(req: NextRequest) {
  if (req.cookies.get("admin_auth")?.value !== "1") {
    return NextResponse.json({ error: "未授权，请先登录管理后台" }, { status: 401 });
  }

  let apply = false;
  try {
    const body = await req.json();
    apply = body?.apply === true;
  } catch {
    /* 允许空 body，默认 dryRun */
  }

  /* 读取索引，筛出 summary 缺失的条目 */
  const metas = await readDocsMeta();
  const pending = metas.filter((m) => !m.summary || !m.summary.trim());

  if (pending.length === 0) {
    return NextResponse.json({
      mode: apply ? "apply" : "dryRun",
      pendingCount: 0,
      message: "所有文档都已有摘要，无需补齐",
    });
  }

  if (!apply) {
    return NextResponse.json({
      mode: "dryRun",
      pendingCount: pending.length,
      pending: pending.map((m) => ({ id: m.id, title: m.title, date: m.date })),
      hint: '确认无误后，加 { "apply": true } 真正生成并写回 Redis',
    });
  }

  /* 串行处理：避免对 aihubmix 造成并发限流；每篇独立 try/catch，不因一篇失败阻断后续 */
  const results: Array<{
    id: string;
    title: string;
    status: "ok" | "fail";
    error?: string;
    summary?: string;
  }> = [];

  for (const meta of pending) {
    try {
      const doc = await getDocById(meta.id);
      if (!doc) {
        results.push({
          id: meta.id,
          title: meta.title,
          status: "fail",
          error: "doc:{id} 在 Redis 里找不到（可能是孤儿索引）",
        });
        continue;
      }

      const plainText = extractPlainText(doc.content);
      if (!plainText) {
        results.push({
          id: meta.id,
          title: meta.title,
          status: "fail",
          error: "正文纯文本为空",
        });
        continue;
      }

      const summary = await generateSummary(plainText);
      await updateDocSummary(meta.id, summary);
      results.push({ id: meta.id, title: meta.title, status: "ok", summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: meta.id, title: meta.title, status: "fail", error: msg });
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  return NextResponse.json({
    mode: "apply",
    total: results.length,
    okCount,
    failCount: results.length - okCount,
    results,
  });
}
