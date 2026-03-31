import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Calendar } from "lucide-react";
import { notFound } from "next/navigation";
import { getDocById } from "@/lib/docs";

/* 动态生成页面标题，让浏览器标签显示文章名称 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await getDocById(id);
  return {
    title: doc ? `${doc.title} · 读书会群分享回顾` : "读书会群分享回顾",
  };
}

/**
 * 根据文档内容特征选择排版方案
 * 短文用大字体宽松行距；长文用紧凑排版减少滚动；列表密集型收紧列表间距
 */
function getTypographyClass(html: string) {
  const plainText = html.replace(/<[^>]+>/g, "");
  const charCount = plainText.length;
  const listCount = (html.match(/<li[\s>]/g) || []).length;
  const isListHeavy = listCount > 10;

  /* 根据字数选择 prose 尺寸 */
  let sizeClass: string;
  if (charCount < 500) {
    sizeClass = "prose-lg";
  } else if (charCount < 3000) {
    sizeClass = "prose-base";
  } else {
    sizeClass = "prose-sm";
  }

  /* 列表密集型文档加上标记，CSS 中做特殊处理 */
  const extraClass = isListHeavy ? "doc-list-heavy" : "";

  return `${sizeClass} ${extraClass}`.trim();
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getDocById(id);

  if (!doc) notFound();

  const typoClass = getTypographyClass(doc.content);

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

      {/* 文档阅读区 */}
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
    </div>
  );
}
