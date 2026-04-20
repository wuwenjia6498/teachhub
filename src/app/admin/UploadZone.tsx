"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Upload,
} from "lucide-react";
import { invalidateDocCache } from "@/lib/clientCache";

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

interface UploadZoneProps {
  /** 上传成功后通知父组件刷新文档列表 */
  onUploaded: () => void;
}

/**
 * 拖拽上传区域
 * --------------------------------------------------------------------------
 * 链路（2026-04 改造）：
 *   1. @vercel/blob/client 的 upload() 把 .docx 直传 Vercel Blob（绕开 4.5MB 限制）
 *   2. 拿到 Blob URL 后 POST 一个轻量 JSON 到 /api/upload，触发服务端解析 + 摘要 + 写 Redis
 * 两个阶段用不同的进度指示：sending 真实百分比，parsing 不确定态流动条。
 */
export default function UploadZone({ onUploaded }: UploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");
  const [shareDate, setShareDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  /* 上传进度：0-100，仅在"浏览器 → Vercel Blob"阶段有效。
   * 解析阶段因为在服务端跑，前端拿不到进度，统一显示"解析中"。 */
  const [uploadPercent, setUploadPercent] = useState(0);
  /* 细分阶段：sending（浏览器直传 Blob） / parsing（服务端解析入库） */
  const [phase, setPhase] = useState<"idle" | "sending" | "parsing">("idle");

  const inputRef = useRef<HTMLInputElement>(null);

  /* ==========================================================================
   * 上传主流程
   * ======================================================================== */
  const handleUpload = useCallback(
    async (file: File, date: string) => {
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
      setPhase("sending");
      setUploadPercent(0);
      setMessage("正在上传文件...");

      try {
        /* Step 1. 客户端直传到 Vercel Blob（无 4.5MB 限制，支持进度感知） */
        const blob = await upload(`uploads/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload/blob-token",
          contentType:
            file.type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          onUploadProgress: (p) => {
            setUploadPercent(Math.round(p.percentage));
          },
        });

        /* Step 2. 触发服务端解析入库 —— 只传 URL + 元数据，几百字节。
         * 服务端会同步执行：解析 docx → 图片外置 → AI 生成摘要 → 写 Redis。
         * 通常耗时 8-20 秒（视文档大小 / 图片数量 / AI 响应时长）。 */
        setPhase("parsing");
        setUploadPercent(100);
        setMessage("文件已上传，正在解析文档并生成摘要...");
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl: blob.url,
            date,
            title: file.name.replace(/\.docx$/i, ""),
          }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          setState("success");
          setMessage(`更新成功，已添加「${data.doc.title}」至首页。`);
          setPendingFile(null);
          /* 首页列表缓存失效，保证返回首页能立刻看到新文档 */
          invalidateDocCache();
          onUploaded();
        } else {
          setState("error");
          setMessage(data.error || "上传失败，请重试");
        }
      } catch (err) {
        /* upload() 抛错时也走到这里：未登录 / 文件类型不对 / 超过 50MB / 网络中断 */
        setState("error");
        const msg = err instanceof Error ? err.message : "";
        setMessage(msg ? `上传失败：${msg}` : "网络错误，请检查连接后重试");
      } finally {
        setPhase("idle");
      }
    },
    [onUploaded],
  );

  /* 拖拽事件 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState("dragging");
  }, []);

  const onDragLeave = useCallback(() => {
    setState("idle");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      setPendingFile(file);
      setState("idle");
    }
  }, []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setPendingFile(file);
        setState("idle");
      }
    },
    [],
  );

  /* 重置上传区域，回到初始空闲状态 */
  const reset = useCallback(() => {
    setState("idle");
    setMessage("");
    setPendingFile(null);
    setUploadPercent(0);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <>
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
        onClick={() =>
          state !== "uploading" && !pendingFile && inputRef.current?.click()
        }
        className={`
          relative w-full max-w-lg aspect-4/3 rounded-2xl border-2 border-dashed
          flex flex-col items-center justify-center gap-4
          transition-all duration-300 ease-out
          ${
            pendingFile && state === "idle"
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
            className={`transition-colors ${
              state === "dragging" ? "text-[#7aab8e]" : "text-[#b0b0b0]"
            }`}
          />
        )}

        <div className="text-center px-6">
          {state === "idle" && !pendingFile && (
            <p className="text-[#8a8a8a] text-sm leading-relaxed">
              请将 Word (.docx) 文件拖拽至此
              <br />
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
          {(state === "uploading" ||
            state === "success" ||
            state === "error") && (
            <p
              className={`text-sm ${
                state === "error" ? "text-[#ab7a7a]" : "text-[#6a8a7a]"
              }`}
            >
              {message}
            </p>
          )}

          {/* 上传进度条
           * - sending（浏览器 → Vercel Blob）：真实进度 0-100%，平滑过渡
           * - parsing（服务端解析）：拿不到真实进度，改用不确定态的流动条 */}
          {state === "uploading" && (
            <div className="mt-3 w-56 mx-auto">
              <div className="h-1.5 rounded-full bg-[#e8e5df] overflow-hidden relative">
                {phase === "sending" && (
                  <div
                    className="h-full bg-[#8aab9a] transition-[width] duration-200 ease-out"
                    style={{ width: `${uploadPercent}%` }}
                  />
                )}
                {phase === "parsing" && (
                  <>
                    <div className="h-full w-full bg-[#c6dcd1]" />
                    <div className="absolute inset-y-0 left-0 w-1/3 bg-[#8aab9a] animate-[progress-indeterminate_1.4s_ease-in-out_infinite]" />
                  </>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-[#a0a0a0] tracking-wide">
                {phase === "sending"
                  ? `${uploadPercent}%`
                  : "服务端处理中..."}
              </p>
            </div>
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
    </>
  );
}
