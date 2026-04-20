"use client";

import { useRef } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import LoginGate from "./LoginGate";
import UploadZone from "./UploadZone";
import DocList, { type DocListHandle } from "./DocList";

/**
 * /admin 入口
 * --------------------------------------------------------------------------
 * 这里只做三件事：
 *   1. 用 <LoginGate> 包一层，未登录时展示密码框
 *   2. 渲染顶部导航
 *   3. 把 <UploadZone> 和 <DocList> 串起来：上传成功时通过 ref 让列表刷新
 *
 * 2026-04 之前本文件单文件 640+ 行，鉴权/上传/编辑/删除糅在一起，
 * 现在拆为三个独立的 Client Component，各自自洽。
 */
export default function AdminPage() {
  /* 把列表的 refresh 方法存在 ref 里，UploadZone 成功后调用它 */
  const listRef = useRef<DocListHandle | null>(null);

  return (
    <LoginGate>
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

        {/* 主区域：文案 → 上传区 → 文档列表 */}
        <main className="flex-1 flex flex-col items-center px-6 py-12">
          <h1 className="text-xl font-medium text-[#4a4a4a] mb-2">文档管理</h1>
          <p className="text-sm text-[#9a9a9a] mb-8">
            上传 Word 文档，系统将自动解析入库
          </p>

          <UploadZone onUploaded={() => listRef.current?.refresh()} />

          <DocList onReady={(handle) => (listRef.current = handle)} />
        </main>
      </div>
    </LoginGate>
  );
}
