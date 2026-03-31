import { NextRequest, NextResponse } from "next/server";
import { deleteDoc } from "@/lib/docs";

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
