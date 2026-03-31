import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
const kv = Redis.fromEnv();
import type { Doc } from "@/types/doc";
import type { DocMeta } from "@/lib/docs";

/**
 * POST /api/migrate
 * 一次性将 database.json 的历史数据导入 Vercel KV。
 * 需在请求头携带 Authorization: Bearer {ADMIN_PASSWORD} 鉴权。
 * 导入成功后此接口无需再调用。
 */
export async function POST(req: NextRequest) {
  /* 鉴权：必须提供管理密码 */
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbPath = path.join(process.cwd(), "database.json");
    const raw = fs.readFileSync(dbPath, "utf-8");
    const docs: Doc[] = JSON.parse(raw);

    /* 按 id 倒序，保持最新在前 */
    docs.sort((a, b) => Number(b.id) - Number(a.id));

    /* 构建元信息索引（不含 content） */
    const index: DocMeta[] = docs.map(({ id, date, title, summary }) => ({
      id,
      date,
      title,
      summary,
    }));

    /* 并行写入所有完整文档 */
    await Promise.all(docs.map((doc) => kv.set(`doc:${doc.id}`, doc)));

    /* 写入元信息索引 */
    await kv.set("docs:index", index);

    return NextResponse.json({ success: true, count: docs.length });
  } catch (err) {
    console.error("迁移失败:", err);
    return NextResponse.json({ error: "迁移失败" }, { status: 500 });
  }
}
