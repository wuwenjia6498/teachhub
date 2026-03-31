import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { Doc } from "@/types/doc";

const DB_PATH = path.join(process.cwd(), "database.json");

/* DELETE /api/docs/[id] — 根据 id 删除指定文档 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const docs: Doc[] = JSON.parse(raw);
    const filtered = docs.filter((d) => d.id !== id);

    if (filtered.length === docs.length) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    fs.writeFileSync(DB_PATH, JSON.stringify(filtered, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("删除文档失败:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
