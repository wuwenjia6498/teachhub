import fs from "fs";
import path from "path";

import type { Doc } from "@/types/doc";

const DB_PATH = path.join(process.cwd(), "database.json");

/** 读取全部文档；失败时返回空数组，保证页面和接口可兜底。 */
export function readDocs(): Doc[] {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw) as Doc[];
  } catch {
    return [];
  }
}

/** 返回按时间倒序排列的文档列表，便于首页和接口共用同一排序规则。 */
export function readSortedDocs(): Doc[] {
  return readDocs().sort((a, b) => Number(b.id) - Number(a.id));
}

/** 按 id 查找单篇文档，详情页直接复用。 */
export function getDocById(id: string): Doc | null {
  return readDocs().find((doc) => doc.id === id) ?? null;
}

/** 将最新文档插入数组头部并覆盖写回 JSON 文件。 */
export function prependDoc(doc: Doc): void {
  const docs = readDocs();
  docs.unshift(doc);
  fs.writeFileSync(DB_PATH, JSON.stringify(docs, null, 2), "utf-8");
}
