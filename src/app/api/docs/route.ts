import { NextResponse } from "next/server";
import { readSortedDocsMeta } from "@/lib/docs";

/**
 * GET /api/docs — 返回文档元信息列表（不含 content），按 id 倒序
 *
 * 显式 no-store：管理员刚编辑/上传完会立刻请求本接口，任何浏览器 / CDN
 * 层面的缓存都会让他看到旧数据。index 体量小（几十条 meta），不缓存对
 * 整体性能几乎无影响；读多写少的场景下，服务端 unstable_cache 已经挡在
 * Redis 前面，真正的耗时在那一层就被吸收了。
 */
export async function GET() {
  try {
    const list = await readSortedDocsMeta();
    return NextResponse.json(list, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
