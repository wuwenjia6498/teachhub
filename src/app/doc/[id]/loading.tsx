import { ArrowLeft } from "lucide-react";

/**
 * /doc/[id] 的加载态骨架屏
 * Next.js App Router 在服务端组件渲染完成前会自动显示本组件，
 * 避免用户点击后看到白屏，极大改善「点击文章很慢」的感知。
 */
export default function DocLoading() {
  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* 顶部返回栏（与正式页面一致，保持视觉稳定） */}
      <header className="sticky top-0 z-10 bg-[#f8f7f4]/80 backdrop-blur-md border-b border-[#e8e5df]">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="inline-flex items-center gap-1.5 text-sm text-[#8a8a8a]">
            <ArrowLeft size={16} />
            <span>返回首页</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* 标题骨架 */}
        <div className="mb-8 pb-6 border-b border-[#e8e5df] animate-pulse">
          <div className="h-7 w-2/3 rounded-md bg-[#ece9e2] mb-3" />
          <div className="h-3 w-24 rounded bg-[#ece9e2]" />
        </div>

        {/* 摘要骨架 */}
        <div className="mb-8 px-5 py-4 rounded-xl bg-[#f0f4f1] border border-[#dde5df] animate-pulse">
          <div className="h-3 w-full rounded bg-[#dde5df] mb-2" />
          <div className="h-3 w-5/6 rounded bg-[#dde5df]" />
        </div>

        {/* 正文骨架：模拟几段文字 */}
        <div className="space-y-6 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-full rounded bg-[#ece9e2]" />
              <div className="h-3 w-11/12 rounded bg-[#ece9e2]" />
              <div className="h-3 w-4/5 rounded bg-[#ece9e2]" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
