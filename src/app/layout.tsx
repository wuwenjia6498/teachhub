import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * 字体优化：
 * - 英文/数字用 next/font 的 Inter（latin 子集，~20KB，自托管，0 请求外部 CDN）
 * - 中文保持走系统字体栈（PingFang/苹方、Microsoft YaHei/微软雅黑），
 *   避免加载几 MB 的中文字体包。
 * - display: "swap" 让文字在字体加载前先以系统字体呈现，杜绝 FOIT。
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "读书会群分享回顾",
  description: "极简内部教研知识库，支持 Word 文档上传与全文搜索",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body className="bg-[#f8f7f4] text-[#3d3d3d] antialiased min-h-screen flex flex-col font-sans">
        <div className="flex-1">{children}</div>
        <footer className="py-6 text-center text-xs text-[#c0b8a8] tracking-wide">
          © 2026 老约翰儿童阅读
        </footer>
      </body>
    </html>
  );
}
