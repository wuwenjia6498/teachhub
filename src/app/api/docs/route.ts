import { NextResponse } from "next/server";
import { readSortedDocsMeta } from "@/lib/docs";

/* GET /api/docs — 返回文档元信息列表（不含 content），按 id 倒序 */
export async function GET() {
  try {
    const list = await readSortedDocsMeta();
    return NextResponse.json(list);
  } catch {
    return NextResponse.json([]);
  }
}
