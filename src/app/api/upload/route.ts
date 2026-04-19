import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import type { Doc } from "@/types/doc";
import { prependDoc } from "@/lib/docs";
import { uploadImage } from "@/lib/imageStorage";

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

/* POST /api/upload — 接收 .docx 文件，解析后写入 Vercel KV */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "请上传 .docx 格式的文件" },
        { status: 400 }
      );
    }

    /* 将 File 转为 Buffer 供 mammoth 解析 */
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    /* 使用 mammoth 将 docx 转为 HTML，保留基础格式
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

    /* 从文件名提取标题（去掉 .docx 后缀） */
    const title = file.name.replace(/\.docx$/i, "");

    /* 提取纯文本用于 AI 摘要 */
    const plainText = htmlContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const summary = await generateSummary(plainText);

    /* 分享日期：优先使用前端传入的人工选择日期，否则取当前日期 */
    const inputDate = formData.get("date") as string | null;
    const date =
      inputDate && /^\d{4}-\d{2}-\d{2}$/.test(inputDate)
        ? inputDate
        : new Date().toISOString().split("T")[0];
    const id = String(Date.now());

    const newDoc: Doc = { id, date, title, content: htmlContent, summary };

    /* 写入 Vercel KV */
    await prependDoc(newDoc);

    return NextResponse.json({ success: true, doc: { id, date, title, summary } });
  } catch (err) {
    console.error("上传解析失败:", err);
    return NextResponse.json(
      { error: "文件解析失败，请确认文件格式正确" },
      { status: 500 }
    );
  }
}
