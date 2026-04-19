"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar } from "lucide-react";
import type { Doc } from "@/types/doc";
import { cacheGet, cacheSet, docKey } from "@/lib/clientCache";
import CopyGuard from "./CopyGuard";

/**
 * 根据文档内容特征选择排版方案
 * 短文用大字体宽松行距；长文用紧凑排版减少滚动；列表密集型收紧列表间距
 */
function getTypographyClass(html: string) {
  const plainText = html.replace(/<[^>]+>/g, "");
  const charCount = plainText.length;
  const listCount = (html.match(/<li[\s>]/g) || []).length;
  const isListHeavy = listCount > 10;

  let sizeClass: string;
  if (charCount < 500) sizeClass = "prose-lg";
  else if (charCount < 3000) sizeClass = "prose-base";
  else sizeClass = "prose-sm";

  const extraClass = isListHeavy ? "doc-list-heavy" : "";
  return `${sizeClass} ${extraClass}`.trim();
}

/**
 * 文档内容客户端视图
 * - 挂载时同步将 SSR 正文写入 sessionStorage，供返回/再次访问时秒开
 * - 如果 sessionStorage 已有缓存（由首页 hover 预拉触发），直接用缓存版本
 *   避免等待旧 RSC 响应造成的视觉闪烁
 */
export default function DocView({ initialDoc }: { initialDoc: Doc }) {
  const [doc, setDoc] = useState<Doc>(initialDoc);

  /* id 变化或首次挂载时，尝试用 sessionStorage 的更快副本覆盖 */
  useEffect(() => {
    const cached = cacheGet<Doc>(docKey(initialDoc.id));
    if (cached && cached.content) {
      setDoc(cached);
    } else {
      /* SSR 数据已到达，就把它灌入 sessionStorage 供会话内复用 */
      cacheSet(docKey(initialDoc.id), initialDoc, 30 * 60 * 1000);
      setDoc(initialDoc);
    }
  }, [initialDoc]);

  const typoClass = useMemo(() => getTypographyClass(doc.content), [doc.content]);

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* 顶部返回栏 */}
      <header className="sticky top-0 z-10 bg-[#f8f7f4]/80 backdrop-blur-md border-b border-[#e8e5df]">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#8a8a8a] hover:text-[#5a8a6a] transition-colors"
          >
            <ArrowLeft size={16} />
            <span>返回首页</span>
          </Link>
        </div>
      </header>

      {/* 文档阅读区（CopyGuard 防止随手复制） */}
      <CopyGuard>
        <main className="max-w-3xl mx-auto px-6 py-10">
          {/* 标题区域 */}
          <div className="mb-8 pb-6 border-b border-[#e8e5df]">
            <h1 className="text-2xl font-semibold text-[#2d2d2d] leading-snug mb-3">
              {doc.title}
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-[#b0a898]">
              <Calendar size={13} />
              <span>{doc.date}</span>
            </div>
          </div>

          {/* AI 摘要 */}
          {doc.summary && (
            <div className="mb-8 px-5 py-4 rounded-xl bg-[#f0f4f1] border border-[#dde5df]">
              <p className="text-sm text-[#5a7a6a] leading-relaxed">{doc.summary}</p>
            </div>
          )}

          {/* 正文：prose 尺寸根据内容长度自适应 */}
          <article
            className={`prose prose-stone max-w-none ${typoClass}
                       prose-headings:text-[#3d3d3d] prose-headings:font-semibold
                       prose-p:text-[#555] prose-p:leading-loose
                       prose-a:text-[#5a8a6a] prose-a:no-underline hover:prose-a:underline
                       prose-strong:text-[#3d3d3d]
                       prose-li:text-[#555] prose-li:leading-loose
                       prose-blockquote:border-l-[#c5d5cb] prose-blockquote:text-[#777]`}
            dangerouslySetInnerHTML={{ __html: doc.content }}
          />
        </main>
      </CopyGuard>
    </div>
  );
}
