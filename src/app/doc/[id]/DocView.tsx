"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar } from "lucide-react";
import type { Doc } from "@/types/doc";
import { cacheSet, docKey } from "@/lib/clientCache";
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
 * --------------------------------------------------------------------------
 * 策略（2026-04 修订）：
 *   - SSR 下发的 initialDoc 始终视为**权威版本**，直接用于渲染
 *   - 挂载后做 write-through：把 initialDoc 写入 sessionStorage，
 *     下次返回 / 再次访问本页时前端有"秒开快照"
 *   - **不再**用 sessionStorage 的版本覆盖 initialDoc——旧实现会让
 *     "管理员刚改过标题 / 重新抽图" 的新 SSR 内容被 30 分钟前的旧缓存盖掉，
 *     造成"新内容闪一下又变回旧内容"的视觉闪烁
 */
export default function DocView({ initialDoc }: { initialDoc: Doc }) {
  /* 以 SSR 数据为准，无需额外 state 去覆盖 */
  const doc = initialDoc;

  /* 挂载后把最新的 SSR 结果写回 sessionStorage，供本标签页内再次访问时秒开 */
  useEffect(() => {
    cacheSet(docKey(initialDoc.id), initialDoc, 30 * 60 * 1000);
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
