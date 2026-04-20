import { readDocsMeta, getDocById, updateDocSummary } from "@/lib/docs";

/* ============================================================================
 * AI 摘要通用逻辑
 * ----------------------------------------------------------------------------
 * 抽离出来给以下三个入口共用，避免重复：
 *   - /api/upload                     ：新文档上传时异步生成（走 after()）
 *   - /api/admin/backfill-summaries   ：管理员手动批量补齐
 *   - /api/cron/backfill-summaries    ：Vercel Cron 每日自动扫漏
 * ========================================================================== */

const AIHUBMIX_API_URL = "https://aihubmix.com/v1/chat/completions";
const AIHUBMIX_MODEL = "gemini-2.5-flash";

/**
 * 调用 AIHUBMIX Gemini 生成摘要。
 * 设计约定：
 *   - API Key 缺失 → 抛错（避免调用方在"静默失败"和"配置错误"之间难以排查）
 *   - HTTP 非 2xx → 抛错，消息里带状态码 + 响应片段，方便在日志里定位
 *   - 成功但内容为空 → 抛错（Gemini 偶尔会因安全过滤返回空串）
 *
 * 调用方（如 /api/upload 的 after() 回调）若希望"失败也不影响主流程"，
 * 自行包一层 try/catch 吞掉即可。
 */
export async function generateSummary(plainText: string): Promise<string> {
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

/** 去掉 HTML 标签 / 折叠空白，得到送给 LLM 的纯文本 */
export function extractPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/* ==========================================================================
 * backfillMissingSummaries —— 批量补齐"summary 为空"的文档
 * -------------------------------------------------------------------------- */

export type BackfillMode = "dryRun" | "apply";

export type BackfillItemResult = {
  id: string;
  title: string;
  status: "ok" | "fail";
  error?: string;
  summary?: string;
};

export type BackfillResult =
  | {
      mode: "dryRun";
      pendingCount: number;
      pending: Array<{ id: string; title: string; date: string }>;
    }
  | {
      mode: "apply";
      total: number;
      okCount: number;
      failCount: number;
      results: BackfillItemResult[];
    };

/**
 * 扫描索引里所有 summary 为空的文档，按需生成并写回 Redis。
 *
 * @param options.apply  默认 false → 仅 dryRun 列出待处理清单，不调用 AI。
 * @param options.limit  单次最多处理多少篇，默认 10。这是为了兼容 Vercel maxDuration=60s：
 *                       AI 单篇通常 2-5 秒，串行跑 10 篇保守估算 50 秒内完成。
 *                       剩余漏的下一次 cron / 手动再触发即可。
 *
 * 失败处理：
 *   - 单篇失败仅记录在 results 里，不中断后续处理（避免一篇卡死整批）
 *   - 整体只抛 generateSummary 之外的系统性错误（比如 readDocsMeta 直接失败）
 */
export async function backfillMissingSummaries(options?: {
  apply?: boolean;
  limit?: number;
}): Promise<BackfillResult> {
  const apply = options?.apply === true;
  const limit = Math.max(1, options?.limit ?? 10);

  const metas = await readDocsMeta();
  const pending = metas.filter((m) => !m.summary || !m.summary.trim());

  if (!apply) {
    return {
      mode: "dryRun",
      pendingCount: pending.length,
      pending: pending.map((m) => ({ id: m.id, title: m.title, date: m.date })),
    };
  }

  /* 只处理前 limit 篇；剩余留给下一轮 */
  const batch = pending.slice(0, limit);
  const results: BackfillItemResult[] = [];

  for (const meta of batch) {
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
  return {
    mode: "apply",
    total: results.length,
    okCount,
    failCount: results.length - okCount,
    results,
  };
}
