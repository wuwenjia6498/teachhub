import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { del } from "@vercel/blob";
import type { Doc } from "@/types/doc";
import { prependDoc } from "@/lib/docs";
import { uploadImage } from "@/lib/imageStorage";

/* ============================================================================
 * Route Segment Config
 * ----------------------------------------------------------------------------
 * - runtime = 'nodejs'：mammoth 依赖 Node API（Buffer / zlib），不能跑 Edge
 * - maxDuration = 60：Vercel Hobby 计划允许的最长函数执行时间（秒）。
 *   用户感知时长 = 解析 docx + 图片并发上传 Blob + AI 摘要 + 写 Redis（通常 8-20 秒）。
 *   摘要生成放在主流程里保证稳定性，避免 after() 在 serverless worker 被提前
 *   回收时静默失败。60 秒足以覆盖 aihubmix 的最坏响应时间。
 * ========================================================================== */
export const runtime = "nodejs";
export const maxDuration = 60;

const AIHUBMIX_API_URL = "https://aihubmix.com/v1/chat/completions";
const AIHUBMIX_MODEL = "gemini-2.5-flash";

/**
 * 调用 AIHUBMIX Gemini 生成文档核心摘要
 * 若 API Key 未配置或调用失败，静默回退返回空字符串
 */
async function generateSummary(plainText: string): Promise<string> {
  const apiKey = process.env.AIHUBMIX_API_KEY;
  if (!apiKey) return "";

  try {
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

    if (!res.ok) return "";

    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("AI 摘要生成失败，将使用默认截取:", err);
    return "";
  }
}

/* ============================================================================
 * POST /api/upload
 * ----------------------------------------------------------------------------
 * 改造要点（2026-04）：
 *   旧：前端把 .docx 以 FormData 直接 POST 到这里
 *       —— 受 Vercel 4.5MB 请求体限制，超过 4-5MB 的文档在生产端失败
 *   新：前端先把 .docx 直传到 Vercel Blob（@vercel/blob/client 的 upload()），
 *       拿到临时 Blob URL 后，再 POST 一个小 JSON 到这里。本函数：
 *         1. 从 Blob URL 把 docx 拉回 buffer（Vercel 内网 CDN，极快）
 *         2. 走原来的 mammoth 解析 / 图片外置 / AI 摘要 / 写 Redis
 *         3. 删除那个临时 docx Blob，避免占用存储配额
 *
 * 请求体：{ blobUrl: string, date?: "YYYY-MM-DD", title?: string }
 *   - blobUrl: 前端直传后拿到的 Vercel Blob URL（必填）
 *   - date:    人工选择的分享日期，默认今天
 *   - title:   文档标题，默认从 blobUrl 文件名（去掉 .docx / 随机后缀）推断
 * ========================================================================== */
export async function POST(req: NextRequest) {
  /* 鉴权：只有登录过 /admin 的用户才能触发解析入库 */
  if (req.cookies.get("admin_auth")?.value !== "1") {
    return NextResponse.json({ error: "未授权，请先登录管理后台" }, { status: 401 });
  }

  /* ---------- 1. 解析请求体，拿到临时 docx 的 Blob URL ---------- */
  let blobUrl: string | undefined;
  let inputDate: string | undefined;
  let inputTitle: string | undefined;
  try {
    const body = await req.json();
    blobUrl = typeof body?.blobUrl === "string" ? body.blobUrl : undefined;
    inputDate = typeof body?.date === "string" ? body.date : undefined;
    inputTitle = typeof body?.title === "string" ? body.title : undefined;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，应为 JSON" }, { status: 400 });
  }

  if (!blobUrl) {
    return NextResponse.json({ error: "缺少 blobUrl" }, { status: 400 });
  }

  /* 仅信任 Vercel Blob 域名的 URL，避免被当 SSRF 跳板 */
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(blobUrl)) {
    return NextResponse.json({ error: "blobUrl 非法" }, { status: 400 });
  }

  try {
    /* ---------- 2. 从 Blob 拉回 docx buffer ---------- */
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `拉取 Blob 失败：${fileRes.status}` },
        { status: 500 },
      );
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    /* ---------- 3. mammoth 解析 docx → HTML，图片实时外置到 Blob ----------
     * 关键优化：docx 内嵌的图片不再编进 base64（会让 HTML 膨胀到几 MB），
     * 而是直接上传到 Vercel Blob，HTML 里只留 <img src="https://..."> 的引用。
     * 效果：单篇文档 HTML 通常从 2-3MB 降到 50-200KB。
     */
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          try {
            const imgBuffer = await image.readAsBuffer();
            const url = await uploadImage(imgBuffer, image.contentType);
            return { src: url };
          } catch (err) {
            /* 图片上传失败：降级为 base64 保证内容不丢，但会打日志提醒 */
            console.error("图片上传 Blob 失败，回落 base64:", err);
            const b64 = await image.readAsBase64String();
            return { src: `data:${image.contentType};base64,${b64}` };
          }
        }),
      },
    );
    const htmlContent = result.value;

    /* ---------- 4. 生成标题 / 日期 ---------- */
    /* 标题优先用前端传的（原始文件名 -> 去 .docx）；否则从 URL 兜底 */
    const title =
      (inputTitle ?? "").replace(/\.docx$/i, "").trim() ||
      decodeURIComponent(
        blobUrl.split("/").pop() ?? "未命名",
      ).replace(/\.docx$/i, "").replace(/-[A-Za-z0-9]{8,}$/, "");

    /* 分享日期：优先使用前端传入的人工选择日期，否则取当前日期 */
    const date =
      inputDate && /^\d{4}-\d{2}-\d{2}$/.test(inputDate)
        ? inputDate
        : new Date().toISOString().split("T")[0];
    const id = String(Date.now());

    /* ---------- 5. 同步生成 AI 摘要 ----------
     * 放在入库前串行执行，响应返回时 summary 已落库。
     * 权衡：用户上传等待时间从 3-5 秒变成 8-20 秒，换来"摘要 100% 不丢"的稳定性。
     * generateSummary 内部 try/catch 兜底：AI 失败时返回空串，此时文档仍然入库，
     * 只是 summary 为空——可以事后用 /api/admin/backfill-summaries 手动补齐。 */
    const plainText = htmlContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const summary = await generateSummary(plainText);

    /* ---------- 6. 拼接最终文档并写入 Redis ---------- */
    const newDoc: Doc = { id, date, title, content: htmlContent, summary };
    await prependDoc(newDoc);

    /* ---------- 7. 清理：删除临时 docx Blob（失败只记日志，不影响用户结果） ---------- */
    try {
      await del(blobUrl);
    } catch (err) {
      console.error("删除临时 docx Blob 失败（忽略）:", err);
    }

    return NextResponse.json({
      success: true,
      doc: { id, date, title, summary },
    });
  } catch (err) {
    console.error("上传解析失败:", err);
    /* 失败时也尽量清掉临时 docx，避免孤儿文件堆积 */
    try {
      await del(blobUrl);
    } catch {
      /* 忽略清理错误 */
    }
    return NextResponse.json(
      { error: "文件解析失败，请确认文件格式正确" },
      { status: 500 },
    );
  }
}
