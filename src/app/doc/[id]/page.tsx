import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDocById } from "@/lib/docs";
import DocView from "./DocView";

/**
 * ISR：每 1 小时重新生成一次；期间所有请求直接命中已缓存的静态 HTML，
 * 不再等待 Upstash Redis 的网络往返。
 *
 * 为什么不用 generateStaticParams 在构建时预渲染所有文章？
 * 部分文章 HTML 含大量 base64 图片（单篇常常 2-3MB），
 * 构建时 React renderToString 会卡 60 秒以上触发 Next.js 的超时重试。
 * 改为**按需 ISR**：首次访问时 SSR，随后 1 小时内所有访问都命中 CDN 静态 HTML。
 */
export const revalidate = 3600;

/* dynamicParams=true：新增文档也能按需生成并缓存 */
export const dynamicParams = true;

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

export default async function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await getDocById(id);

  if (!doc) notFound();

  /* 服务端将 Doc 注入客户端组件；客户端会尝试用 sessionStorage
     的更快/更新版本覆盖，实现"首页 hover 预拉 → 点击秒开"的体验 */
  return <DocView initialDoc={doc} />;
}
