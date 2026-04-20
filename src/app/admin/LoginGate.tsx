"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Lock } from "lucide-react";

/**
 * 管理员登录门面
 * --------------------------------------------------------------------------
 * 职责：
 *   1. 挂载时 GET /api/auth 探测当前是否已有 admin_auth cookie
 *   2. 未登录 → 渲染密码输入框，POST /api/auth 成功后标记已登录
 *   3. 已登录 → 通过 children 渲染内部页面
 *
 * 对父组件只暴露一个布尔状态（children 是否被渲染），所有密码 / UI 细节封闭在本组件内。
 */
export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  /* 挂载时检查是否已登录（避免刷新后重新输密码） */
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setAuthed(true);
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  /* 提交密码登录 */
  const handleLogin = async () => {
    setAuthError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setAuthError(data.error || "验证失败");
    }
  };

  /* 首次探测中：显示 loading，避免闪烁登录框 */
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <Loader2 size={28} className="text-[#b0b0b0] animate-spin" />
      </div>
    );
  }

  /* 已登录：透传子内容 */
  if (authed) return <>{children}</>;

  /* 未登录：显示密码框 */
  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs flex flex-col items-center gap-6">
        <div className="w-14 h-14 rounded-2xl bg-white border border-[#e5e2dc] flex items-center justify-center">
          <Lock size={24} className="text-[#8aab9a]" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-medium text-[#4a4a4a]">管理后台</h1>
          <p className="text-sm text-[#9a9a9a] mt-1">请输入管理密码以继续</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
          className="w-full flex flex-col gap-3"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoFocus
            className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#e0ddd6]
                       text-sm text-[#3d3d3d] placeholder-[#c0c0c0]
                       focus:outline-none focus:border-[#a8c5b8] focus:ring-2 focus:ring-[#a8c5b8]/20
                       transition-all"
          />
          {authError && (
            <p className="text-xs text-[#ab7a7a] text-center">{authError}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-[#8aab9a] text-white text-sm font-medium
                       hover:bg-[#7a9b8a] active:scale-[0.98] transition-all"
          >
            进入管理
          </button>
        </form>
        <Link
          href="/"
          className="text-xs text-[#aaa] hover:text-[#888] transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
