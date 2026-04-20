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
| 数据存储 | **Upstash Redis**（文档正文 + 元信息，gzip 压缩） |
| 图片存储 | **Vercel Blob**（docx 内嵌图片外置，SHA-256 去重） |

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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 读写 Token（docx 内嵌图片外置 / 历史图片迁移） | 必填 |

Upstash 连接信息获取方式：登录 [upstash.com](https://upstash.com) → 选择数据库 → 复制 REST API 区域的 URL 和 Token。

Vercel Blob 获取方式：Vercel 控制台 → 项目 → Storage → Create Database → Blob；创建后在 `.env.local` tab 一键复制 `BLOB_READ_WRITE_TOKEN`。

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
6. 在 Vercel 控制台 **Storage → Create Database → Blob** 新建 Blob 存储，`BLOB_READ_WRITE_TOKEN` 会自动注入
7. 重新部署后，按需调用两个一次性迁移接口：

```bash
# 将 database.json 历史数据导入 Upstash Redis（仅全新环境需要）
curl -X POST https://你的域名/api/migrate \
  -H "Authorization: Bearer 你的ADMIN_PASSWORD"

# 把历史文档 HTML 里的 base64 图片全部外置到 Vercel Blob
# 先加 ?dryRun=1 只看统计不改数据，确认无误后再去掉参数真正执行
curl -X POST "https://你的域名/api/migrate/extract-images?dryRun=1" \
  -H "Authorization: Bearer 你的ADMIN_PASSWORD"

curl -X POST https://你的域名/api/migrate/extract-images \
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
| `/api/docs/[id]` | GET | 返回单篇完整文档（含正文），带 `Cache-Control` 强缓存，供 hover 预拉 |
| `/api/docs/[id]` | DELETE | 删除指定文档（需在管理页操作） |
| `/api/upload/blob-token` | POST | 为浏览器端 Vercel Blob 直传签发一次性 token（需 admin cookie） |
| `/api/upload` | POST | 接收 `{ blobUrl, date, title }` JSON，从 Blob 拉回 `.docx` 解析 + 图片外置 + AI 摘要后入 Redis，处理完自动删临时文件 |
| `/api/migrate` | POST | 一次性将 `database.json` 历史数据迁移至 Upstash Redis（需鉴权） |
| `/api/migrate/extract-images` | POST | 一次性把 Redis 里历史文档的 base64 图片抽出，外置到 Vercel Blob（需鉴权） |
| `/api/migrate/clean-orphan-images` | POST | 扫描 Blob 与 Redis 对比，列出/删除"无文档引用"的孤儿图（需鉴权） |
| `/api/migrate/reconcile-index` | POST | 对账 `doc:*` 与 `docs:index`，修复"内容存在但索引里没有"的孤儿文档（需鉴权） |

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
│   │   ├── docs.ts                 # Upstash Redis 读写封装（带内存缓存 + gzip）
│   │   ├── clientCache.ts          # 浏览器 sessionStorage 缓存 + hover 预拉
│   │   └── imageStorage.ts         # Vercel Blob 图片上传抽象（SHA-256 去重）
│   └── app/
│       ├── layout.tsx              # 根布局 + next/font 字体 + 全局 metadata
│       ├── page.tsx                # 首页（客户端，含搜索 + 分页 + hover 预拉）
│       ├── globals.css             # Tailwind + Typography 样式
│       ├── admin/
│       │   └── page.tsx            # 上传管理页（拖拽上传 + 删除）
│       ├── doc/[id]/
│       │   ├── page.tsx            # 文档详情页（服务端 SSR + ISR + generateStaticParams）
│       │   ├── loading.tsx         # 加载骨架屏（消除点击白屏）
│       │   ├── DocView.tsx         # 客户端视图（sessionStorage 缓存命中即时显示）
│       │   └── CopyGuard.tsx       # 防复制保护组件
│       └── api/
│           ├── docs/route.ts                       # GET 文档列表
│           ├── docs/[id]/route.ts                  # GET 单篇 / DELETE 删除
│           ├── upload/route.ts                     # POST .docx 上传（含图片外置）
│           ├── migrate/route.ts                          # POST 历史数据迁移
│           ├── migrate/extract-images/route.ts           # POST base64 图片外置到 Blob
│           └── migrate/clean-orphan-images/route.ts      # POST 孤儿图列出/清理
└── package.json
```

---

## 数据存储说明

**Redis**（Upstash）存储文本与元信息，采用三类 Key：

| Key | 内容 | 用途 |
|-----|------|------|
| `docs:index` | 所有文档元信息数组（无正文） | 首页列表、搜索 |
| `doc:{id}` | 单篇完整文档（正文 gzip 压缩后 base64 编码，带 `__gz__` 前缀） | 详情页阅读 |
| `img:{sha256-32hex}` | 图片 hash → Blob URL 的映射 | 图片上传去重 |

上传新文档时同时更新前两处；删除时同时移除前两处。读取时自动解压，向后兼容旧的明文数据。

**Vercel Blob** 存储 docx 中的图片：

- 上传 docx 时 mammoth 的 `convertImage` 钩子把每张图单独传到 `images/{hash}.{ext}`
- 按 SHA-256 内容去重（同一张图只存一份）
- HTML 里只保留 `<img src="https://...">` URL 引用
- 效果：单篇文档 HTML 通常从 2~3MB 降到 50~200KB

---

## 性能优化（阅读速度）

针对「点击文章打开慢」这一核心体验，采用了多层缓存 + 预加载策略：

### 服务端
1. **按需 ISR**：`/doc/[id]` 带 `revalidate = 3600`、`dynamicParams = true`。首次访问 SSR 后 CDN 缓存 1 小时；不在构建期预渲染全部文章，避免大文档（曾经的 2~3MB base64 HTML）拖垮构建。
2. **进程级内存缓存**（`src/lib/docs.ts`）：模块级 `Map` + TTL，同一 Node 进程内重复读取零网络 IO，dev/prod 都生效。
3. **Next.js `unstable_cache`**：按 tag 失效，保证写入后立即看到最新数据。
4. **内容 gzip 压缩**：写入 Redis 前对 HTML 做 gzip (level 9)，体积降到 15-25%，网络传输更快；读取时自动解压，向后兼容老数据。

### 客户端
5. **`<Link prefetch>`**：Next.js 生产环境下视口内链接自动预取 RSC。
6. **Hover 预拉 + sessionStorage**（`src/lib/clientCache.ts`）：鼠标在卡片停留 >120ms 即调用 `/api/docs/[id]` 并缓存；移动端 `touchstart` 立即触发。
7. **列表会话缓存**：首页列表入 sessionStorage（30min TTL），返回时先用缓存秒开再后台同步最新。
8. **文档页双数据源**：服务端 SSR 出 `DocView` 初始数据，客户端挂载时尝试用 sessionStorage 的更新/更快版本覆盖。
9. **loading.tsx 骨架屏**：点击即显示占位，消除白屏等待感。

### 渲染层
10. **`next/font` + 系统中文字体栈**：英文用 Inter (latin 子集，~20KB 自托管)，中文走系统字体，`display: swap` 避免 FOIT。
11. **LCP 优化**：首页 logo 加 `priority` 提前加载。

---

## 图片外置 Vercel Blob 纪要

> 本节记录 2026-04 的一次重大优化：把 docx 内嵌的 base64 图片从 Redis 里全部抽出外置到 Vercel Blob。
> 真实收益：Redis 里全部文档的 HTML 体积从 **≈ 86 MB** 缩到 **≈ 0.33 MB**（压缩 99.6%），文章详情页首屏几乎秒开。

### 架构对比

**旧（base64 内嵌）**

```
浏览器 ────(请求文章)────▶ Next.js SSR
                             │
                             ▼
                       读 Upstash Redis
                             │
                    单篇 HTML 常 2-3 MB，包含 base64 图
                             │
                             ▼
                    阻塞式返回完整 HTML
                    （图片不加载完，文字也出不来）
```

**新（Blob 外置 + 去重）**

```
浏览器 ────(请求文章)────▶ Next.js SSR
                             │
                             ▼
                       读 Upstash Redis
                             │
                    单篇 HTML 通常 10-20 KB（只剩文本 + <img src>）
                             │
                             ▼
                    秒出文字  ───▶ 浏览器并行请求 CDN 图片
                                    │
                                    ▼
                          Vercel Blob (images/<sha256>.<ext>)
                                    │
                               按 SHA-256 去重，同图只存 1 份
```

### 三类迁移接口（一次性操作，跑完即可忘）

| 接口 | 何时需要 | 推荐流程 |
|---|---|---|
| `/api/migrate`                         | 仅"从 database.json 首次初始化 Redis" | 只跑一次 |
| `/api/migrate/extract-images`          | 首次启用 Blob、把历史 base64 外置 | 先 `?dryRun=1` 看统计，再去掉参数正式执行 |
| `/api/migrate/clean-orphan-images`     | 定期（如每季度）清理无引用的 Blob | 先 `?dryRun=1` 列孤儿，无误再正式删除 |

所有接口都需要 `Authorization: Bearer $ADMIN_PASSWORD`。

**示例（PowerShell，本地或生产同理）**

```powershell
# 1) 历史 base64 图片外置 —— dryRun
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/migrate/extract-images?dryRun=1" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }

# 2) 满意后去掉 dryRun 正式执行
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/migrate/extract-images" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }

# 3) 孤儿图清理 —— dryRun 看有没有孤儿
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/migrate/clean-orphan-images?dryRun=1" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }
```

**示例（bash / 线上环境）**

```bash
curl -X POST "https://你的域名/api/migrate/extract-images?dryRun=1" \
  -H "Authorization: Bearer $ADMIN_PASSWORD"

curl -X POST "https://你的域名/api/migrate/clean-orphan-images?dryRun=1" \
  -H "Authorization: Bearer $ADMIN_PASSWORD"
```

### 运维注意事项

1. **本地与线上共用同一个 Upstash Redis**：本地跑迁移 = 直接改生产数据。跑任何写操作前务必确认。
2. **Vercel Blob 必须创建为 Public Store**：Private Store 返回的 URL 需签名，无法直接在 `<img src>` 使用。如误建成 Private，请删除后重建。
3. **新上传 docx 自动走 Blob**：`/api/upload` 里用 mammoth 的 `convertImage` 钩子拦截内嵌图片直传 Blob，HTML 里只写 URL。历史文档走过一次 `extract-images` 即可。
4. **SHA-256 去重记在 Redis**：键为 `img:{hash32}`。删除 Blob 图片时 `clean-orphan-images` 会同步清这条映射，下次同内容图片会重新上传而不是命中失效 URL。
5. **防复制开关**：`NEXT_PUBLIC_DISABLE_COPY_GUARD=1` 只在本地调试时设置。**不要**在 Vercel 生产环境配置这个变量，否则右键/复制保护会失效。

---

## 大文件上传链路（2026-04 改造）

> 背景：Vercel Serverless Function 对请求体有 **4.5 MB** 的硬限制，
> 带图 Word 文档常常超过这个值，导致生产端上传报 "网络连接错误"。
> 本次改造把上传通道从 "浏览器 → 函数 → Blob" 改为 "浏览器 → Blob → 函数"。

### 新链路

```
┌────────┐  1. POST handshake  ┌─────────────────────────┐
│浏览器  │ ──────────────────▶ │ /api/upload/blob-token  │  (签发短期 token)
│admin   │ ◀──────────────────  └─────────────────────────┘
│页面    │  2. PUT docx 直传（绕开 4.5MB 限制，最大 50MB）
│        │ ──────────────────▶  https://*.blob.vercel-storage.com
│        │  3. 拿到 Blob URL
│        │  4. POST { blobUrl, date, title }  ┌────────────────┐
│        │ ─────────────────────────────────▶ │ /api/upload    │
│        │                                    │ (maxDuration60)│
│        │                                    │ fetch blob →   │
│        │                                    │ mammoth 解析 → │
│        │                                    │ 图片外置 Blob→ │
│        │                                    │ AI 摘要 →      │
│        │                                    │ 写 Redis →     │
│        │                                    │ 删除临时 docx  │
│        │ ◀───────────────────────────────── └────────────────┘
└────────┘  5. { success, doc }
```

### 关键点

- `/api/upload/blob-token` **必须校验 admin cookie**，否则任何人都能白嫖存储配额；
- `/api/upload` 只接受来自 `*.public.blob.vercel-storage.com` 的 URL，避免被当 SSRF 跳板；
- 临时 docx 解析完立即调 `@vercel/blob` 的 `del()` 删除，成功/失败都清理；
- `export const maxDuration = 60` 把函数超时从 Hobby 默认的 10s 提到 60s（Hobby 计划上限）；
- 本地开发同样走新链路，只要 `BLOB_READ_WRITE_TOKEN` 配好即可，无需额外调整。

### 索引对账（孤儿文档恢复）

早期 `prependDoc` / `deleteDoc` 基于缓存读旧索引再覆盖写，在"本地 + 生产"
或多 warm 实例交替上传时可能触发 lost update，造成：

- **孤儿文档**：`doc:{id}` 还在 Redis，但被挤出了 `docs:index` → 首页看不到
- **悬空索引**：`docs:index` 提到某个 id，但 `doc:{id}` 已被删除 → 详情页 404

接口 `/api/migrate/reconcile-index` 提供三种模式处理这类不一致：

```powershell
# 1) dryRun：只读诊断，列出孤儿/悬空清单（含 title/date/contentPreview）
Invoke-RestMethod `
  -Uri "https://你的域名/api/migrate/reconcile-index?mode=dryRun" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }

# 2) restore：把孤儿 doc 的 meta 合并回 docs:index，并清除悬空条目
Invoke-RestMethod `
  -Uri "https://你的域名/api/migrate/reconcile-index?mode=restore" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }

# 3) purge：把孤儿的 doc:{id} 从 Redis 直接删掉，并清除悬空条目
Invoke-RestMethod `
  -Uri "https://你的域名/api/migrate/reconcile-index?mode=purge" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:ADMIN_PASSWORD" }
```

**推荐流程**：先 dryRun 看清单 → 判断孤儿是否要保留 → 要保留跑 restore，
不要跑 purge → 最后再 dryRun 一次验证 `orphanCount=0 && danglingCount=0` 即对账完成。

### 体验 & 性能优化（配套）

1. **上传进度条**（`admin/page.tsx`）：接 `@vercel/blob/client` 的 `onUploadProgress`
   回调，浏览器→Blob 阶段显示真实百分比；服务端解析阶段显示不确定态流动条，
   keyframes 定义在 `globals.css` 的 `progress-indeterminate`。
2. **AI 摘要异步化**（`api/upload/route.ts`）：用 Next.js 15 的 `after()` 在
   响应返回后继续生成 Gemini 摘要，生成完再调 `updateDocSummary()` 补回 Redis。
   用户感知的 `/api/upload` 时长从原来 15-35s 缩到 5-15s。响应体新增
   `summaryPending: true`，前端文案提示 "摘要将在 10-20 秒后自动生成"。
3. **Edge Runtime 冷启动**（`api/upload/blob-token/route.ts`）：该路由只用 Web
   标准 API，加 `export const runtime = "edge"` 后冷启动从 300-600ms 降到
   5-30ms。admin 低频访问下体感非常明显。
