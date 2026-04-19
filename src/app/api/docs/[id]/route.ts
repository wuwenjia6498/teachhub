import { NextRequest, NextResponse } from "next/server";
import { deleteDoc, getDocById, updateDocMeta } from "@/lib/docs";
import { isAdmin } from "@/lib/adminAuth";

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

/**
 * PATCH /api/docs/[id] — 编辑文档元信息（仅 title / date）
 * 需要管理员 cookie 鉴权；不涉及正文，不影响 Blob 图片。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: unknown;
      date?: unknown;
    };

    /* 只接收两个字段；类型错误直接拒绝，避免写入脏数据 */
    const patch: { title?: string; date?: string } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.date === "string") patch.date = body.date;

    if (patch.title === undefined && patch.date === undefined) {
      return NextResponse.json(
        { error: "请至少提供 title 或 date 其中一个字段" },
        { status: 400 },
      );
    }

    const updated = await updateDocMeta(id, patch);
    return NextResponse.json({ success: true, doc: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "编辑失败";
    /* 文档不存在返回 404，其它业务错误返回 400 */
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* DELETE /api/docs/[id] — 根据 id 删除指定文档；需管理员身份 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 401 });
  }

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
