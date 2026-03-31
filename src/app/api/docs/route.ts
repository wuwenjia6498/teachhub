import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { Doc } from "@/types/doc";

/* 数据文件路径：项目根目录下的 database.json */
const DB_PATH = path.join(process.cwd(), "database.json");

/* GET /api/docs — 返回文档列表（不含 content 全文，避免传输量过大），按 id 倒序 */
export async function GET() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const docs: Doc[] = JSON.parse(raw);
    docs.sort((a, b) => Number(b.id) - Number(a.id));
    const list = docs.map(({ id, date, title, summary }) => ({
      id, date, title, summary,
    }));
    return NextResponse.json(list);
  } catch {
    return NextResponse.json([]);
  }
}
