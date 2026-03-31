"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Fuse from "fuse.js";
import { Search, FileText, ChevronDown, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Doc } from "@/types/doc";

/** 按月份分组：{ "2026年3月": Doc[], ... } */
function groupByMonth(docs: Doc[]) {
  const groups: { label: string; docs: Doc[] }[] = [];
  const map = new Map<string, Doc[]>();

  for (const doc of docs) {
    const [y, m] = doc.date.split("-");
    const label = `${y}年${parseInt(m)}月`;
    if (!map.has(label)) {
      const arr: Doc[] = [];
      map.set(label, arr);
      groups.push({ label, docs: arr });
    }
    map.get(label)!.push(doc);
  }
  return groups;
}

const PAGE_SIZE = 3;

export default function HomePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [visibleMonths, setVisibleMonths] = useState(PAGE_SIZE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /* 拉取文档列表 */
  useEffect(() => {
    fetch("/api/docs")
      .then((res) => res.json())
      .then((data: Doc[]) => setDocs(data))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  /* 构建 Fuse 搜索实例 */
  const fuse = useMemo(
    () =>
      new Fuse(docs, {
        keys: [
          { name: "title", weight: 2 },
          { name: "summary", weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [docs]
  );

  /* 搜索结果 */
  const results = useMemo(() => {
    if (!query.trim()) return docs;
    return fuse.search(query).map((r) => r.item);
  }, [query, docs, fuse]);

  /* 按月分组 */
  const groups = useMemo(() => groupByMonth(results), [results]);

  /* 当前可见的分组（分页） */
  const visibleGroups = useMemo(
    () => (query ? groups : groups.slice(0, visibleMonths)),
    [groups, visibleMonths, query]
  );
  const hasMore = !query && visibleMonths < groups.length;

  /* 展开/折叠月份 */
  const toggleMonth = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }, []);

  const getCardSummary = (doc: Doc) => doc.summary || "";

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* 顶部搜索栏 */}
      <header className="sticky top-0 z-10 bg-[#f8f7f4]/80 backdrop-blur-md border-b border-[#e8e5df]">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/logo.png" alt="老约翰儿童阅读" width={32} height={32} className="rounded-full" />
            <span className="text-base font-medium text-[#4a4a4a] tracking-wide hidden sm:inline">
              TeachHub
            </span>
          </Link>

          <div className="relative flex-1 z-20">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#b0b0b0] pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入书名、难点或关键词搜索教研资料..."
              className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-white border border-[#e0ddd6]
                         text-sm text-[#3d3d3d] placeholder:text-[#b8b8b8]
                         focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                         transition-all"
            />
          </div>

          <Link
            href="/admin"
            className="shrink-0 p-2 rounded-lg text-[#b0b0b0] hover:text-[#5a8a6a] hover:bg-[#eef4f0] transition-colors"
            title="管理"
          >
            <Settings size={20} />
          </Link>
        </div>
      </header>

      {/* 内容区 */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#c5d5cb] border-t-[#8aab9a] rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-20">
            <FileText size={40} className="mx-auto text-[#d0d0d0] mb-4" />
            <p className="text-[#aaa] text-sm">
              {query ? "未找到匹配的文档" : "暂无文档，前往 /admin 上传"}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {visibleGroups.map(({ label, docs: groupDocs }) => {
              const isCollapsed = collapsed.has(label);
              return (
                <section key={label}>
                  {/* 月份标题，可点击折叠 */}
                  <button
                    onClick={() => toggleMonth(label)}
                    className="flex items-center gap-2 mb-4 group cursor-pointer"
                  >
                    <ChevronDown
                      size={16}
                      className={`text-[#b0a898] transition-transform duration-200
                                  ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    <h3 className="text-sm font-medium text-[#8a8a8a] group-hover:text-[#5a8a6a] transition-colors">
                      {label}
                    </h3>
                    <span className="text-xs text-[#c0b8a8]">({groupDocs.length} 篇)</span>
                  </button>

                  {/* 卡片列表 */}
                  {!isCollapsed && (
                    <div className="space-y-4">
                      {groupDocs.map((doc) => (
                        <Link
                          key={doc.id}
                          href={`/doc/${doc.id}`}
                          className="group block bg-white rounded-xl border border-[#eae7e0] p-5
                                     shadow-[0_1px_3px_rgba(0,0,0,0.04)]
                                     hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]
                                     hover:border-[#d5ddd8]
                                     transition-all duration-300 ease-out"
                        >
                          <div className="text-xs text-[#b0a898] mb-2 tracking-wide">
                            分享时间：{doc.date}
                          </div>
                          <h2 className="text-base font-medium text-[#3d3d3d] group-hover:text-[#5a8a6a] transition-colors leading-snug">
                            {doc.title}
                          </h2>
                          {getCardSummary(doc) && (
                            <p className="mt-2 text-sm text-[#999] leading-relaxed">
                              {getCardSummary(doc)}
                            </p>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            {/* 加载更多 */}
            {hasMore && (
              <div className="flex justify-center pt-4 pb-8">
                <button
                  onClick={() => setVisibleMonths((v) => v + PAGE_SIZE)}
                  className="px-6 py-2.5 text-sm text-[#8a8a8a] bg-white rounded-full
                             border border-[#e0ddd6] hover:border-[#c5d5cb] hover:text-[#5a8a6a]
                             transition-colors"
                >
                  加载更早的文档
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
