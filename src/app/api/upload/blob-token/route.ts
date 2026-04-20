import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/**
 * POST /api/upload/blob-token
 * -----------------------------------------------------------------------------
 * 为浏览器端的 Vercel Blob 直传签发一次性短期 token。
 *
 * 背景：Vercel Serverless Function 对请求体大小有 4.5 MB 硬限制，
 * 一旦 .docx 超过这个值，传统的 multipart/form-data 上传会被平台直接拦下，
 * 前端表现为 "网络连接错误"。解决思路是让浏览器直接把文件传到 Vercel Blob，
 * 跳过自己的 Serverless 入口；然后再用一个只带 URL 的小请求去触发解析。
 *
 * 这个路由就是 "握手" 阶段：
 *   - 浏览器 @vercel/blob/client 的 upload() 会先 POST 一个 HandleUploadBody 过来
 *   - 这里校验 admin 身份后，调用 handleUpload() 返回 token
 *   - 浏览器拿 token 直传到 blob.vercel-storage.com（走 Vercel CDN，不走我们的函数）
 */

/** 仅 admin cookie 校验通过的人才有资格请求上传 token，避免被第三方白嫖存储配额 */
function isAuthed(req: NextRequest): boolean {
  return req.cookies.get("admin_auth")?.value === "1";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        /* 每次签发前都校验 admin cookie；未登录直接抛错不下发 token */
        if (!isAuthed(req)) {
          throw new Error("未授权，请先登录管理后台");
        }

        return {
          /* 只允许 .docx 类型。部分浏览器会把 .docx 识别为 octet-stream，也放行 */
          allowedContentTypes: [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/octet-stream",
          ],
          /* 上限放宽到 50MB，覆盖绝大多数带图 Word 文档；真正的体积风险在 Blob 侧而非函数 */
          maximumSizeInBytes: 50 * 1024 * 1024,
          /* 加随机后缀避免同名文件互相覆盖（临时 docx 马上会删除，名字无所谓） */
          addRandomSuffix: true,
          /* 临时 docx 我们会在解析完成后主动删除，就不用依赖缓存 */
          cacheControlMaxAge: 0,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        /* 仅作为调试日志。注意：本地开发环境 Vercel 无法回调到 localhost，
         * 这里在生产才会触发；业务落库逻辑 **不要** 依赖此回调，
         * 而是由客户端主动调 /api/upload 触发，确保本地 / 生产行为一致。 */
        console.log("[blob-token] 临时 docx 上传完成:", blob.pathname);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "签发上传 token 失败";
    console.error("[blob-token] 签发失败:", err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
