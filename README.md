# 读书会群分享回顾

极简、优雅的读书会教研资料知识库。支持 Word 文档上传、自动解析、AI 摘要生成与全文模糊搜索。

线上地址：[teachhub-sigma.vercel.app](https://teachhub-sigma.vercel.app)

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 15 (App Router) + React 19 + TypeScript |
| 样式 | Tailwind CSS v4 + @tailwindcss/typography |
| 图标 | lucide-react |
| 文档解析 | mammoth（`.docx` → HTML） |
| AI 摘要 | AIHUBMIX 平台 Gemini 2.5 Flash |
| 前端搜索 | fuse.js（模糊匹配） |
| 数据存储 | **Upstash Redis**（Serverless HTTP Redis，部署于 Vercel） |

> 本地开发时数据存储同样连接云端 Upstash Redis，本地与线上共享同一份数据。

---

## 环境变量

复制 `.env.local.example` 为 `.env.local` 并填入各项值：

```bash
cp .env.local.example .env.local
```

| 变量名 | 说明 | 是否必填 |
|--------|------|----------|
| `AIHUBMIX_API_KEY` | AIHUBMIX 平台 API Key，用于上传时调用 Gemini 生成摘要 | 可选 |
| `ADMIN_PASSWORD` | 管理后台 `/admin` 的访问密码 | 必填 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API 地址 | 必填 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | 必填 |

Upstash 连接信息获取方式：登录 [upstash.com](https://upstash.com) → 选择数据库 → 复制 REST API 区域的 URL 和 Token。

---

## 快速启动（本地开发）

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填入 ADMIN_PASSWORD 和 Upstash 连接信息

# 3. 启动开发服务器
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)

---

## 部署到 Vercel

1. 将代码推送到 GitHub
2. 在 Vercel 导入项目并触发自动部署
3. 在 Vercel 控制台 **Storage** → 连接 Upstash Redis 数据库
4. Vercel 会自动注入 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 环境变量
5. 在 **Settings → Environment Variables** 手动添加 `ADMIN_PASSWORD` 和 `AIHUBMIX_API_KEY`
6. 重新部署后，调用迁移接口导入历史数据（如有）：

```bash
# 将 database.json 中的历史数据一次性导入 Upstash Redis（只需执行一次）
curl -X POST https://你的域名/api/migrate \
  -H "Authorization: Bearer 你的ADMIN_PASSWORD"
```

---

## 路由说明

| 路由 | 说明 |
|------|------|
| `/` | 首页 — 文档卡片列表 + 实时模糊搜索，按月份分组展示 |
| `/doc/[id]` | 详情页 — 长文阅读排版，字体/行距根据文档长度自适应 |
| `/admin` | 管理页 — 拖拽上传 `.docx` 文件，自动解析入库并生成 AI 摘要 |

---

## API 说明

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/docs` | GET | 返回全部文档元信息列表（不含正文，按时间倒序） |
| `/api/docs/[id]` | DELETE | 删除指定文档（需在管理页操作） |
| `/api/upload` | POST | 接收 `.docx` 文件，解析 + 生成摘要后写入 Upstash Redis |
| `/api/migrate` | POST | 一次性将 `database.json` 历史数据迁移至 Upstash Redis（需鉴权） |

---

## 项目结构

```
teachub/
├── public/
│   └── logo-1.png                  # 顶部 Logo 图片
├── database.json                   # 历史数据备份（仅用于迁移，线上不再读写）
├── .env.local.example              # 环境变量模板
├── src/
│   ├── types/
│   │   └── doc.ts                  # 共享数据类型（Doc / DocMeta）
│   ├── lib/
│   │   └── docs.ts                 # Upstash Redis 读写封装（增删查）
│   └── app/
│       ├── layout.tsx              # 根布局 + 全局 metadata
│       ├── page.tsx                # 首页（客户端，含搜索 + 分页）
│       ├── globals.css             # Tailwind + Typography 样式
│       ├── admin/
│       │   └── page.tsx            # 上传管理页（拖拽上传 + 删除）
│       ├── doc/[id]/
│       │   └── page.tsx            # 文档详情页（动态 title + 自适应排版）
│       └── api/
│           ├── docs/route.ts       # GET 文档列表
│           ├── docs/[id]/route.ts  # DELETE 删除文档
│           ├── upload/route.ts     # POST 文件上传
│           └── migrate/route.ts   # POST 历史数据迁移（一次性）
└── package.json
```

---

## 数据存储说明

数据存储在 **Upstash Redis** 中，采用两层结构：

| Key | 内容 | 用途 |
|-----|------|------|
| `docs:index` | 所有文档元信息数组（无正文） | 首页列表、搜索 |
| `doc:{id}` | 单篇完整文档（含 HTML 正文） | 详情页阅读 |

上传新文档时同时更新两处；删除时同时移除两处。
