import { NextRequest, NextResponse } from "next/server";
import { deleteDoc, getDocById } from "@/lib/docs";

/**
 * GET /api/docs/[id] — 返回单篇完整文档（含正文）
 * 带强缓存 header，方便首页 hover 预拉 & 浏览器 bfcache 复用：
 *   s-maxage=3600               CDN 缓存 1 小时
 *   stale-while-revalidate=86400  过期后 24h 内先回旧版本再后台更新
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await getDocById(id);
    if (!doc) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }
    return NextResponse.json(doc, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("读取文档失败:", err);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }
}

/* DELETE /api/docs/[id] — 根据 id 删除指定文档 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteDoc(id);

    if (!deleted) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("删除文档失败:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
