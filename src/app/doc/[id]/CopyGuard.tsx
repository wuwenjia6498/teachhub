"use client";

import { useEffect } from "react";

/**
 * 防复制保护组件：
 * - 禁止文字选中（CSS user-select: none）
 * - 屏蔽右键菜单
 * - 拦截 Ctrl/Cmd + C / A 快捷键
 * 注意：此保护仅防止普通用户随手复制，无法阻止查看页面源码的方式。
 */
export default function CopyGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    /* 屏蔽右键菜单 */
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    /* 拦截 Ctrl/Cmd + C 和 Ctrl/Cmd + A */
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["c", "a", "C", "A"].includes(e.key)) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className="select-none"
      onCopy={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
