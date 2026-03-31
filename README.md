# TeachHub · 内部教研知识库

极简、纯前端驱动的内部教研知识库单页应用。支持 Word 文档上传、自动解析入库与全文模糊搜索。

上传 `.docx` 文件时，系统会自动调用 **AIHUBMIX Gemini** 生成文档核心摘要，展示在首页卡片上。

## 技术栈

- **框架** — Next.js 15 (App Router) + React 19 + TypeScript
- **样式** — Tailwind CSS v4 + @tailwindcss/typography
- **图标** — lucide-react
- **文档解析** — mammoth（`.docx` → HTML）
- **AI 摘要** — AIHUBMIX 平台 Gemini 2.5 Flash（上传时自动生成）
- **前端搜索** — fuse.js（模糊匹配）
- **数据存储** — 项目根目录 `database.json`（无传统数据库）

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 配置 AI 摘要（可选但推荐）
cp .env.local.example .env.local
# 编辑 .env.local，填入你的 AIHUBMIX API Key

# 3. 启动开发服务器（Turbopack）
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)

> 未配置 `AIHUBMIX_API_KEY` 时上传仍可正常工作，只是首页卡片会回退为截取文档开头文字。

## 路由说明

| 路由 | 说明 |
|------|------|
| `/` | 首页 — 文档卡片列表 + 实时模糊搜索 |
| `/doc/[id]` | 详情页 — 优雅的长文阅读排版 |
| `/admin` | 管理页 — 拖拽上传 `.docx` 文件，自动解析入库 |

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/docs` | GET | 返回全部文档列表（按时间倒序） |
| `/api/upload` | POST | 接收 `.docx` 文件，mammoth 解析 + Gemini 生成摘要后写入 `database.json` |

## 项目结构

```
teachub/
├── database.json                 # 唯一数据存储（JSON 数组）
├── .env.local.example            # 环境变量模板（AIHUBMIX API Key）
├── eslint.config.mjs             # ESLint 9 扁平配置（与 npm run lint 对应）
├── src/
│   ├── types/
│   │   └── doc.ts                # 共享数据类型（Doc）
│   └── app/
│       ├── layout.tsx            # 根布局
│       ├── page.tsx              # 首页
│       ├── globals.css           # Tailwind + Typography 配置
│       ├── admin/page.tsx        # 上传管理页
│       ├── doc/[id]/page.tsx     # 文档详情页
│       └── api/
│           ├── docs/route.ts     # 文档列表 API
│           └── upload/route.ts   # 文件上传 API
└── package.json
```

仓库根目录另有 [README.md](../README.md)（说明 `task01.md` 与 `teachub/` 的关系）。
