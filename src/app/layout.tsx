import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="zh-CN">
      <body className="bg-[#f8f7f4] text-[#3d3d3d] antialiased min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="py-6 text-center text-xs text-[#c0b8a8] tracking-wide">
          © 2026 老约翰儿童阅读
        </footer>
      </body>
    </html>
  );
}
