"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { invalidateDocCache } from "@/lib/clientCache";

export interface DocItem {
  id: string;
  date: string;
  title: string;
  summary?: string;
}

/** 行内编辑表单的暂存值 */
interface EditDraft {
  title: string;
  date: string;
}

export interface DocListHandle {
  /** 父组件在上传成功后调用，让列表重新拉取一次 */
  refresh: () => void;
}

interface DocListProps {
  /** 暴露给父组件的命令式句柄（简化版：通过回调注入） */
  onReady?: (handle: DocListHandle) => void;
}

/**
 * 已上传文档管理列表
 * --------------------------------------------------------------------------
 * 职责：
 *   - 首次挂载拉取 GET /api/docs
 *   - 行内编辑 title / date（PATCH /api/docs/[id]）
 *   - 删除文档（DELETE /api/docs/[id]）
 *   - 任何写操作成功后自动 invalidateDocCache，保证首页看到最新数据
 *
 * 之所以用 `onReady(handle)` 而不是 `ref + forwardRef`：本组件是 "use client"，
 * 父组件也是 "use client"，传一个函数引用就够，省去 forwardRef + useImperativeHandle 的样板。
 */
export default function DocList({ onReady }: DocListProps) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* 行内编辑态：editingId 为空表示所有行都处于展示态 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ title: "", date: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");

  /* 拉取列表：挂载一次；上传成功后由父组件通过 handle.refresh() 再触发一次 */
  const fetchDocs = useCallback(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then((data: DocItem[]) => setDocs(data))
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => {
    fetchDocs();
    /* 把 refresh 能力暴露给父组件 */
    onReady?.({ refresh: fetchDocs });
  }, [fetchDocs, onReady]);

  /* 删除文档 */
  const handleDelete = useCallback(async (id: string, title: string) => {
    if (!confirm(`确定删除「${title}」吗？此操作不可撤销。`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/docs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== id));
        /* 首页列表 + 单篇详情缓存一并失效 */
        invalidateDocCache(id);
      }
    } catch {
      /* 静默失败：用户重试或检查控制台 */
    }
    setDeletingId(null);
  }, []);

  /* 进入行内编辑：把当前 title/date 作为初值 */
  const startEdit = useCallback((doc: DocItem) => {
    setEditingId(doc.id);
    setEditDraft({ title: doc.title, date: doc.date });
    setEditError("");
  }, []);

  /* 取消编辑：丢弃草稿 */
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditError("");
  }, []);

  /* 保存编辑：PATCH 成功后本地乐观更新，并清缓存 */
  const handleSaveEdit = useCallback(
    async (id: string) => {
      const title = editDraft.title.trim();
      const date = editDraft.date.trim();

      if (!title) {
        setEditError("标题不能为空");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setEditError("日期格式应为 YYYY-MM-DD");
        return;
      }

      setSavingId(id);
      setEditError("");
      try {
        const res = await fetch(`/api/docs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, date }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          setDocs((prev) =>
            prev.map((d) => (d.id === id ? { ...d, title, date } : d)),
          );
          /* 首页列表 + 单篇详情缓存失效，回到首页能立即看到新值 */
          invalidateDocCache(id);
          setEditingId(null);
        } else {
          setEditError(data.error || "保存失败");
        }
      } catch {
        setEditError("网络错误，请重试");
      }
      setSavingId(null);
    },
    [editDraft],
  );

  if (docs.length === 0) return null;

  return (
    <div className="w-full max-w-lg mt-12">
      <h2 className="text-sm font-medium text-[#6a6a6a] mb-4">
        已上传文档（{docs.length} 篇）
      </h2>
      <div className="space-y-2">
        {docs.map((doc) => {
          const isEditing = editingId === doc.id;
          const isSaving = savingId === doc.id;

          return (
            <div
              key={doc.id}
              className="px-4 py-3 bg-white rounded-xl border border-[#eae7e0]"
            >
              {/* 展示态：标题 + 日期 + 3 个行动按钮 */}
              {!isEditing && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#3d3d3d] truncate">{doc.title}</p>
                    <p className="text-xs text-[#b0a898] mt-0.5">{doc.date}</p>
                  </div>

                  {/* 查看原文：新标签页打开详情页 */}
                  <Link
                    href={`/doc/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-2 rounded-lg text-[#9ab0a5] hover:text-[#6a8a7a] hover:bg-[#f1f5f2] transition-colors"
                    title="在新标签页查看原文"
                  >
                    <ExternalLink size={16} />
                  </Link>

                  {/* 编辑 */}
                  <button
                    onClick={() => startEdit(doc)}
                    className="shrink-0 p-2 rounded-lg text-[#9aa5b0] hover:text-[#6a7a8a] hover:bg-[#f1f3f5] transition-colors"
                    title="编辑标题和分享日期"
                  >
                    <Pencil size={16} />
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDelete(doc.id, doc.title)}
                    disabled={deletingId === doc.id}
                    className="shrink-0 p-2 rounded-lg text-[#c0a0a0] hover:text-[#ab7a7a] hover:bg-[#faf5f5]
                               disabled:opacity-40 disabled:cursor-wait transition-colors"
                    title="删除此文档"
                  >
                    {deletingId === doc.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
              )}

              {/* 编辑态：行内表单，保存成功后关闭 */}
              {isEditing && (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editDraft.title}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, title: e.target.value }))
                    }
                    placeholder="标题"
                    className="w-full px-3 py-2 rounded-lg border border-[#e0ddd6]
                               text-sm text-[#3d3d3d]
                               focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                               transition-all"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={editDraft.date}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, date: e.target.value }))
                      }
                      className="flex-1 px-3 py-2 rounded-lg border border-[#e0ddd6]
                                 text-sm text-[#3d3d3d]
                                 focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                                 transition-all"
                    />

                    <button
                      onClick={() => handleSaveEdit(doc.id)}
                      disabled={isSaving}
                      className="shrink-0 p-2 rounded-lg text-[#7aab8e] hover:text-[#5a8b6e] hover:bg-[#f0f5f1]
                                 disabled:opacity-40 disabled:cursor-wait transition-colors"
                      title="保存"
                    >
                      {isSaving ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                    </button>

                    <button
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="shrink-0 p-2 rounded-lg text-[#aaa] hover:text-[#6a6a6a] hover:bg-[#f3f2ef]
                                 disabled:opacity-40 transition-colors"
                      title="取消"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {editError && (
                    <p className="text-xs text-[#ab7a7a]">{editError}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
