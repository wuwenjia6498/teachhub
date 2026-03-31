# 内部教研知识库 (极简单页应用) - 核心开发需求文档 (PRD & Architecture)

## 一、 项目角色与目标
你现在是一个全栈高级工程师。请帮我开发一个极简、纯前端驱动（无传统数据库）的“内部教研知识库”单页应用。
**核心原则：本项目绝对不需要开发任何用户体系、鉴权或登录功能。请保持极简，切勿过度设计。UI色调采用低饱和配色治愈系**

## 二、 技术栈选型 (Tech Stack)
* **核心框架：** Next.js (使用 App Router) + React。利用 Next.js 的 API 路由做轻量级文件处理。
* **UI 框架：** Tailwind CSS (用于极简、清爽排版) + `@tailwindcss/typography` (用于渲染优美的长文本阅读体验) + `lucide-react` (极简图标)。
* **文档解析：** `mammoth` (核心依赖：用于在后端 API 中将上传的 `.docx` 文件自动解析为 HTML)。
* **前端搜索：** `fuse.js` (核心依赖：用于前端的高性能模糊搜索匹配)。

## 三、 数据存储方案 (无数据库架构)
* **禁用：** 不要使用 MySQL/PostgreSQL/MongoDB/Prisma 等任何传统数据库或 ORM。
* **数据源：** 在项目的根目录（或适合读写的安全目录）下，创建并维护一个 `database.json` 文件作为唯一的数据存储。
* **JSON 数据结构标准：**
    ```json
    [
      {
        "id": "1710000000000",
        "date": "2026-03-30",
        "title": "测试文档标题",
        "content": "<h1>这是解析出的 HTML 正文...</h1>"
      }
    ]
    ```

## 四、 核心功能与路由规范

### 1. 极简首页 (路由：`/`)
* **UI 设计：**
    * **顶部栏：** 固定在顶部，包含一个宽大的搜索框 (Placeholder: "输入书名、难点或关键词搜索教研资料...")。
    * **内容区：** 瀑布流/时间轴样式的卡片列表。每张卡片展示 `date` 和 `title`，采用极简的卡片阴影和 hover 效果。
* **交互逻辑：**
    * 页面加载时，拉取 `database.json` 数据，按日期 (`date`) 或 ID (`id`) 倒序渲染卡片。
    * **实时搜索：** 当用户在搜索框输入时，使用 `fuse.js` 对整个数组的 `title` 和 `content` 字段进行模糊匹配，实时过滤并更新下方的卡片列表。点击卡片跳转至详情页。

### 2. 详情阅读页 (路由：`/doc/[id]`)
* **UI 设计：**
    * 顶部提供一个醒目的“返回首页”按钮。
    * 主体区域为居中的宽排版（阅读模式），优雅展示标题和正文。
* **排版要求：** 必须使用 Tailwind 的 `prose` 类名（如 `className="prose max-w-none"`）来渲染传入的 HTML `content`，确保字体间距、标题层级和列表的阅读体验。

### 3. 隐藏的上传管理页 (路由：`/admin`)
* **UI 设计：** 极简的拖拽上传区域，提示语：“请将 Word (.docx) 文件拖拽至此，系统将自动解析入库”。
* **交互逻辑：**
    * 用户选择或拖拽 `.docx` 文件后，前端将文件通过 `FormData` POST 到后端的 `/api/upload` 接口。
    * 上传期间显示 Loading 状态（如“正在解析并更新库...”）。
    * 成功后弹窗提示“更新成功，已添加至首页”，并清空上传状态。

### 4. 后端解析 API (路由：`/api/upload` - 仅限 Next.js Route Handler)
* **处理逻辑：**
    * 接收前端传来的 `.docx` 文件。
    * 调用 `mammoth.extractRawText` 或 `mammoth.convertToHtml` 方法解析文档内容。建议使用 `convertToHtml` 以保留文档的基础格式（如段落、加粗）。
    * **自动字段提取：** * 将上传的文件名（去除 `.docx` 后缀）作为 `title`。
        * 获取当前服务器日期的 YYYY-MM-DD 格式作为 `date`。
        * 生成当前时间戳字符串作为 `id`。
    * **更新 JSON 文件：** * 使用 Node.js 的 `fs` 模块读取现有的 `database.json`。
        * 将新生成的文档对象 `unshift` (插入到最前面) 到数组中。
        * 使用 `fs.writeFileSync` 覆写保存 `database.json`。
    * 返回成功响应给前端。

## 五、 执行步骤要求 (Step-by-Step)
请按照以下顺序逐步生成代码，并在每一步完成后向我确认：
1.  **初始化与依赖：** 帮我写出创建 Next.js 项目并安装所需的 `mammoth`, `fuse.js`, `@tailwindcss/typography`, `lucide-react` 依赖的终端命令。配置好 Tailwind 插件。
2.  **数据层初始化：** 创建初始的 `database.json` 文件，并提供在前端获取该文件数据的通用方法（注意 Server Component 与 Client Component 的数据获取差异）。
3.  **开发后端 API：** 编写 `app/api/upload/route.ts`，完成接收文件、Mammoth 解析和写入 JSON 的完整逻辑。
4.  **开发前端页面 - Admin：** 编写 `/admin` 页面，实现拖拽上传 UI 并联调 API 接口。
5.  **开发前端页面 - 首页：** 编写 `/` 首页，实现列表渲染，并集成 `fuse.js` 实现实时搜索功能。
6.  **开发前端页面 - 详情页：** 编写 `/doc/[id]` 路由，利用 Tailwind Typography 完美渲染文档正文。

现在，请确认你已经完全理解需求，并给出第一步（初始化与依赖）的代码和操作指令。