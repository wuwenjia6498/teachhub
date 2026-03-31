import { kv } from "@vercel/kv";
import type { Doc } from "@/types/doc";

/** 文档元信息（不含正文，用于列表展示） */
export type DocMeta = Omit<Doc, "content">;

/** KV 键名：存储所有文档元信息数组 */
const INDEX_KEY = "docs:index";

/** 读取全部元信息列表；失败时返回空数组 */
export async function readDocsMeta(): Promise<DocMeta[]> {
  try {
    const index = await kv.get<DocMeta[]>(INDEX_KEY);
    return index ?? [];
  } catch {
    return [];
  }
}

/** 按 id（时间戳）倒序排列的元信息列表 */
export async function readSortedDocsMeta(): Promise<DocMeta[]> {
  const docs = await readDocsMeta();
  return docs.sort((a, b) => Number(b.id) - Number(a.id));
}

/** 根据 id 获取完整文档（含 content）；不存在时返回 null */
export async function getDocById(id: string): Promise<Doc | null> {
  try {
    return await kv.get<Doc>(`doc:${id}`);
  } catch {
    return null;
  }
}

/** 将新文档插入 KV：全文存 doc:{id}，元信息追加到索引头部 */
export async function prependDoc(doc: Doc): Promise<void> {
  const { content: _content, ...meta } = doc;

  /* 并行写入：全量存储 + 更新元信息索引 */
  const index = await readDocsMeta();
  index.unshift(meta);

  await Promise.all([
    kv.set(`doc:${doc.id}`, doc),
    kv.set(INDEX_KEY, index),
  ]);
}

/** 按 id 删除文档；成功返回 true，不存在返回 false */
export async function deleteDoc(id: string): Promise<boolean> {
  const index = await readDocsMeta();
  const filtered = index.filter((d) => d.id !== id);

  if (filtered.length === index.length) return false;

  await Promise.all([
    kv.set(INDEX_KEY, filtered),
    kv.del(`doc:${id}`),
  ]);
  return true;
}
