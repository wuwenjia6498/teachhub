/** 文档数据结构 — 对应 database.json 中的每条记录 */
export interface Doc {
  id: string;
  date: string;
  title: string;
  content: string;
  /** AI 生成的核心摘要（上传时由 Gemini 自动生成） */
  summary?: string;
}
