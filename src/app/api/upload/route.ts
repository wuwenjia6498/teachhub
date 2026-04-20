import { NextRequest, NextResponse, after } from "next/server";
import mammoth from "mammoth";
import { del } from "@vercel/blob";
import type { Doc } from "@/types/doc";
import { prependDoc, updateDocSummary } from "@/lib/docs";
import { uploadImage } from "@/lib/imageStorage";
import { generateSummary, extractPlainText } from "@/lib/summaries";

/* ============================================================================
 * Route Segment Config
 * ----------------------------------------------------------------------------
 * - runtime = 'nodejs'：mammoth 依赖 Node API（Buffer / zlib），不能跑 Edge
 * - maxDuration = 60：Vercel Hobby 计划允许的最长函数执行时间（秒）。
 *   用户感知时长 = 解析 docx + 图片并发上传 Blob + 写 Redis（通常 5-15 秒）
 *   after() 里的 AI 摘要生成也计入这个 60 秒预算，但用户已经不用等了。
 * ========================================================================== */
export const runtime = "nodejs";
export const maxDuration = 60;

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

    /* summary 先留空：AI 摘要放到 after() 里异步生成，不阻塞用户响应。
     * 这样用户能在几秒内看到 "已入库"，摘要十几秒后自动补齐。 */
    const newDoc: Doc = { id, date, title, content: htmlContent, summary: "" };

    /* ---------- 5. 写入 Redis ---------- */
    await prependDoc(newDoc);

    /* ---------- 6. 清理：删除临时 docx Blob（失败只记日志，不影响用户结果） ---------- */
    try {
      await del(blobUrl);
    } catch (err) {
      console.error("删除临时 docx Blob 失败（忽略）:", err);
    }

    /* ---------- 7. 后台生成 AI 摘要（响应返回后继续执行） ----------
     * Next.js 15 的 after() 保证在 res 发给客户端之后仍然能跑完这块代码，
     * 同时不算进用户感知的接口耗时。失败也不影响用户：
     *   - 摘要先留空值
     *   - Vercel Cron（/api/cron/backfill-summaries）每 6 小时自动扫漏补齐
     *   - 或者管理员手动调 /api/admin/backfill-summaries 立刻补齐
     */
    const plainText = extractPlainText(htmlContent);
    after(async () => {
      try {
        const summary = await generateSummary(plainText);
        await updateDocSummary(id, summary);
      } catch (err) {
        console.error("[after] AI 摘要后台生成失败（将由 cron 稍后补齐）:", err);
      }
    });

    /* 立刻返回，前端不再等摘要（原本常 5-20 秒） */
    return NextResponse.json({
      success: true,
      doc: { id, date, title, summary: "" },
      summaryPending: true, /* 前端可据此文案提示 "摘要稍后生成" */
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
