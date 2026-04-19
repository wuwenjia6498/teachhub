"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  Home,
  Trash2,
  Lock,
  ExternalLink,
  Pencil,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";
import { cacheDel, docListKey, docKey } from "@/lib/clientCache";

interface DocItem {
  id: string;
  date: string;
  title: string;
  summary?: string;
}

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

/** 行内编辑表单的暂存值 */
interface EditDraft {
  title: string;
  date: string;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");
  const [shareDate, setShareDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* 正在编辑的文档 id + 其暂存的表单值 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ title: "", date: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  /* 检查是否已登录 */
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => { if (d.authenticated) setAuthed(true); })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  /* 提交密码 */
  const handleLogin = async () => {
    setAuthError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      const data = await res.json();
      setAuthError(data.error || "验证失败");
    }
  };

  /* 拉取文档列表 */
  const fetchDocs = useCallback(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then((data: DocItem[]) => setDocs(data))
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => { if (authed) fetchDocs(); }, [authed, fetchDocs]);

  /* 删除文档 */
  const handleDelete = useCallback(async (id: string, title: string) => {
    if (!confirm(`确定删除「${title}」吗？此操作不可撤销。`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/docs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== id));
        /* 首页列表 / 单篇详情缓存同步失效，避免返回首页看到旧数据 */
        cacheDel(docListKey);
        cacheDel(docKey(id));
      }
    } catch { /* 静默 */ }
    setDeletingId(null);
  }, []);

  /* 打开行内编辑表单：填入当前 title/date 作为初值 */
  const startEdit = useCallback((doc: DocItem) => {
    setEditingId(doc.id);
    setEditDraft({ title: doc.title, date: doc.date });
    setEditError("");
  }, []);

  /* 关闭行内编辑（不保存） */
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditError("");
  }, []);

  /* 保存编辑：PATCH 后本地乐观更新，并清首页缓存 */
  const handleSaveEdit = useCallback(async (id: string) => {
    const title = editDraft.title.trim();
    const date = editDraft.date.trim();

    if (!title) { setEditError("标题不能为空"); return; }
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
        /* 首页列表 / 单篇详情客户端缓存失效，回到首页能立即看到新值 */
        cacheDel(docListKey);
        cacheDel(docKey(id));
        setEditingId(null);
      } else {
        setEditError(data.error || "保存失败");
      }
    } catch {
      setEditError("网络错误，请重试");
    }
    setSavingId(null);
  }, [editDraft]);

  /* 处理文件上传 */
  const handleUpload = useCallback(async (file: File, date: string) => {
    if (!file.name.endsWith(".docx")) {
      setState("error");
      setMessage("仅支持 .docx 格式的文件");
      return;
    }
    if (!date) {
      setState("error");
      setMessage("请先选择分享日期");
      return;
    }

    setState("uploading");
    setMessage("正在解析并更新库...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("date", date);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (res.ok && data.success) {
        setState("success");
        setMessage(`更新成功，已添加「${data.doc.title}」至首页`);
        setPendingFile(null);
        fetchDocs();
      } else {
        setState("error");
        setMessage(data.error || "上传失败，请重试");
      }
    } catch {
      setState("error");
      setMessage("网络错误，请检查连接后重试");
    }
  }, [fetchDocs]);

  /* 拖拽事件 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState("dragging");
  }, []);

  const onDragLeave = useCallback(() => {
    setState("idle");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        setPendingFile(file);
        setState("idle");
      }
    },
    []
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setPendingFile(file);
        setState("idle");
      }
    },
    []
  );

  /* 重置上传区域 */
  const reset = () => {
    setState("idle");
    setMessage("");
    setPendingFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /* 加载中 */
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <Loader2 size={28} className="text-[#b0b0b0] animate-spin" />
      </div>
    );
  }

  /* 密码验证界面 */
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-xs flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-white border border-[#e5e2dc] flex items-center justify-center">
            <Lock size={24} className="text-[#8aab9a]" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-medium text-[#4a4a4a]">管理后台</h1>
            <p className="text-sm text-[#9a9a9a] mt-1">请输入管理密码以继续</p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
            className="w-full flex flex-col gap-3"
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#e0ddd6]
                         text-sm text-[#3d3d3d] placeholder-[#c0c0c0]
                         focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                         transition-all"
            />
            {authError && (
              <p className="text-xs text-[#ab7a7a] text-center">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-[#8aab9a] text-white text-sm font-medium
                         hover:bg-[#7a9b8a] active:scale-[0.98] transition-all"
            >
              进入管理
            </button>
          </form>
          <Link
            href="/"
            className="text-xs text-[#aaa] hover:text-[#888] transition-colors"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col">
      {/* 顶部导航 */}
      <header className="px-6 py-4 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-[#8a8a8a] hover:text-[#5a5a5a] transition-colors"
        >
          <Home size={16} />
          <span>返回首页</span>
        </Link>
      </header>

      {/* 主区域 */}
      <main className="flex-1 flex flex-col items-center px-6 py-12">
        <h1 className="text-xl font-medium text-[#4a4a4a] mb-2">文档管理</h1>
        <p className="text-sm text-[#9a9a9a] mb-8">上传 Word 文档，系统将自动解析入库</p>

        {/* 分享日期选择 */}
        <div className="w-full max-w-lg mb-6 flex items-center gap-3">
          <label htmlFor="share-date" className="text-sm text-[#6a6a6a] shrink-0">
            分享日期
          </label>
          <input
            id="share-date"
            type="date"
            value={shareDate}
            onChange={(e) => setShareDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#e0ddd6]
                       text-sm text-[#3d3d3d]
                       focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                       transition-all"
          />
        </div>

        {/* 拖拽上传区域 */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => state !== "uploading" && !pendingFile && inputRef.current?.click()}
          className={`
            relative w-full max-w-lg aspect-4/3 rounded-2xl border-2 border-dashed
            flex flex-col items-center justify-center gap-4
            transition-all duration-300 ease-out
            ${pendingFile && state === "idle"
              ? "border-[#a8c5b8] bg-[#f0f5f1]"
              : state === "dragging"
                ? "border-[#a8c5b8] bg-[#eef4f0] scale-[1.02] cursor-pointer"
                : state === "uploading"
                  ? "border-[#c5c0b8] bg-[#f5f3ef] cursor-wait"
                  : state === "success"
                    ? "border-[#a8c5b8] bg-[#f0f5f1]"
                    : state === "error"
                      ? "border-[#c5a8a8] bg-[#f5f0f0]"
                      : "border-[#d5d0c8] bg-white/60 hover:border-[#b8c5bc] hover:bg-[#f2f5f3] cursor-pointer"
            }
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            onChange={onFileSelect}
            className="hidden"
          />

          {state === "uploading" && (
            <Loader2 size={40} className="text-[#8a9a8e] animate-spin" />
          )}
          {state === "success" && (
            <CheckCircle size={40} className="text-[#7aab8e]" />
          )}
          {state === "error" && (
            <AlertCircle size={40} className="text-[#ab7a7a]" />
          )}
          {(state === "idle" || state === "dragging") && !pendingFile && (
            <Upload
              size={40}
              className={`transition-colors ${state === "dragging" ? "text-[#7aab8e]" : "text-[#b0b0b0]"}`}
            />
          )}

          <div className="text-center px-6">
            {state === "idle" && !pendingFile && (
              <p className="text-[#8a8a8a] text-sm leading-relaxed">
                请将 Word (.docx) 文件拖拽至此<br />
                <span className="text-xs text-[#aaa]">或点击此区域选择文件</span>
              </p>
            )}
            {state === "idle" && pendingFile && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-[#5a8a6a] font-medium">
                  已选择：{pendingFile.name}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpload(pendingFile, shareDate);
                    }}
                    className="px-5 py-2 text-sm rounded-full bg-[#8aab9a] text-white
                               hover:bg-[#7a9b8a] transition-colors"
                  >
                    确认上传
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      reset();
                    }}
                    className="px-4 py-2 text-xs rounded-full bg-white text-[#6a6a6a]
                               border border-[#ddd] hover:bg-[#f0f0f0] transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {state === "dragging" && (
              <p className="text-[#6a9a7a] text-sm font-medium">松开鼠标即可选择</p>
            )}
            {(state === "uploading" || state === "success" || state === "error") && (
              <p className={`text-sm ${state === "error" ? "text-[#ab7a7a]" : "text-[#6a8a7a]"}`}>
                {message}
              </p>
            )}
          </div>

          {/* 成功/失败后显示"继续上传" */}
          {(state === "success" || state === "error") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              className="mt-2 px-4 py-1.5 text-xs rounded-full bg-white text-[#6a6a6a] border border-[#ddd] hover:bg-[#f0f0f0] transition-colors"
            >
              继续上传
            </button>
          )}
        </div>

        {/* 已上传文档列表 */}
        {docs.length > 0 && (
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
                    {/* 非编辑态：标题 + 日期 + 3 个行动按钮 */}
                    {!isEditing && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#3d3d3d] truncate">{doc.title}</p>
                          <p className="text-xs text-[#b0a898] mt-0.5">{doc.date}</p>
                        </div>

                        {/* 查看原文：新标签页打开详情页（不支持下载，只在线预览） */}
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

                    {/* 编辑态：行内表单，保存写回后关闭 */}
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
        )}
      </main>
    </div>
  );
}
