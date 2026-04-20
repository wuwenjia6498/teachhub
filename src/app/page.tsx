"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Fuse from "fuse.js";
import { Search, FileText, ChevronDown, Settings } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { Doc } from "@/types/doc";
import {
  cacheGet,
  cacheSet,
  docListKey,
  prefetchDoc,
} from "@/lib/clientCache";

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
  const [searchFocused, setSearchFocused] = useState(false);

  /* 拉取文档列表：优先命中 sessionStorage，再后台同步 */
  useEffect(() => {
    /* 先用 sessionStorage 的旧数据秒开 UI，减少白屏 */
    const cached = cacheGet<Doc[]>(docListKey);
    if (cached && cached.length) {
      setDocs(cached);
      setLoading(false);
    }

    /* 始终在后台拉一次最新数据，保证内容不过期
     * cache: "no-store" 确保从 admin 回到首页时能立即看到刚改/新增的文档，
     * 避免浏览器 HTTP 缓存屏蔽了服务端已更新的 index */
    fetch("/api/docs", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Doc[]) => {
        setDocs(data);
        cacheSet(docListKey, data, 30 * 60 * 1000); // 30 分钟 TTL
      })
      .catch(() => {
        if (!cached) setDocs([]);
      })
      .finally(() => setLoading(false));
  }, []);

  /* hover 防抖：避免鼠标快速划过每张卡片都发请求 */
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCardHover = useCallback((docId: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    /* 停留超过 120ms 才判断为"用户可能要点"，开始预拉 */
    hoverTimerRef.current = setTimeout(() => {
      prefetchDoc(docId);
    }, 120);
  }, []);
  const handleCardLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
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
            <Image
              src="/logo-1.png"
              alt="TeachHub Logo"
              width={36}
              height={36}
              priority
              className="rounded-full"
            />
            <span className="text-base font-medium text-[#4a4a4a] tracking-wide hidden sm:inline">
              深度阅读群分享回顾
            </span>
          </Link>

          <div className="relative flex-1 z-20">
            {/* 空闲时居中显示图标+文字，激活时移到左侧 */}
            {!searchFocused && !query ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[#b8b8b8] pointer-events-none">
                <Search size={16} />
                <span className="text-sm">Search</span>
              </div>
            ) : (
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#b0b0b0] pointer-events-none"
              />
            )}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder=""
              className={`w-full py-2.5 rounded-xl bg-white border border-[#e0ddd6]
                         text-sm text-[#3d3d3d]
                         focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                         transition-all
                         ${searchFocused || query ? "pl-11 pr-4" : "px-4"}`}
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
                          prefetch={true}
                          onMouseEnter={() => handleCardHover(doc.id)}
                          onMouseLeave={handleCardLeave}
                          /* 移动端：触摸按下就开始预拉（比 click 早 100-300ms） */
                          onTouchStart={() => prefetchDoc(doc.id)}
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
