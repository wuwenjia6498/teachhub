import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { revalidateTag } from "next/cache";
import type { Doc } from "@/types/doc";
import type { DocMeta } from "@/lib/docs";

const kv = Redis.fromEnv();
const INDEX_KEY = "docs:index";
const CACHE_TAG_INDEX = "docs-index";

/**
 * POST /api/migrate/reconcile-index
 * -----------------------------------------------------------------------------
 * 对账 Redis 里的两份数据，修复"文档内容存在但索引丢失"（孤儿）
 * 或"索引里提到的文档内容已不存在"（悬空）这两种不一致。
 *
 * 背景：早期 prependDoc / deleteDoc 基于缓存读旧索引再覆盖写，
 * 本地+生产或多 warm 实例交替写入时会发生 lost update：
 *   - 一些 doc:{id} 还在 Redis 里，但被挤出了 docs:index → 首页看不到，孤儿
 *   - 罕见情况：索引里指向一个已被删的 doc:{id} → 打开详情页 404，悬空
 *
 * 三种模式（通过 ?mode= 查询参数切换）：
 *   - mode=dryRun （默认）：只读诊断，不写任何数据，返回不一致清单
 *   - mode=restore：把孤儿加回 docs:index（按 id 倒序合并），并清掉悬空引用
 *   - mode=purge：把孤儿的 doc:{id} 删掉（索引不动），并清掉悬空引用
 *
 * 鉴权：必须带请求头 Authorization: Bearer {ADMIN_PASSWORD}
 *
 * 典型排查流程：
 *   1. 先跑 dryRun 看清单          → 判断孤儿内容是否要保留
 *   2. 要保留 → 跑 restore          → 孤儿回到索引，再去 admin 页正常管理
 *      不要 → 跑 purge              → 孤儿内容从 Redis 清除
 *   3. 再跑一次 dryRun 应返回 0 条  → 对账完成
 */

/* ---------- 工具 ---------- */

/** 用 SCAN 分页拉取 doc:* 的全部 key；相比 KEYS 更安全，数据再多也不阻塞 Redis */
async function scanAllDocKeys(): Promise<string[]> {
  const keys: string[] = [];
  /* Upstash Redis 的 scan cursor 全程用 string 表示，首次传 "0" 即可 */
  let cursor = "0";
  do {
    /* @upstash/redis 的 scan 返回 [cursor, keys[]] */
    const [nextCursor, batch] = (await kv.scan(cursor, {
      match: "doc:*",
      count: 500,
    })) as [string, string[]];
    keys.push(...batch);
    cursor = nextCursor;
    /* cursor 回到 "0" 表示遍历结束（首次和终止用同一哨兵值） */
  } while (cursor !== "0");
  return keys;
}

/** 从 "doc:xxx" 里抽出 id；不是 doc: 前缀的 key 统一丢弃，防御 SCAN match 走偏 */
function docIdFromKey(key: string): string | null {
  return key.startsWith("doc:") ? key.slice(4) : null;
}

/** 校验单条是不是一个像样的 doc 对象，避免历史脏数据把整个对账接口搞崩 */
function isValidDoc(x: unknown): x is Doc {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Doc).id === "string" &&
    typeof (x as Doc).title === "string"
  );
}

/** 读某个孤儿 doc:{id}，裁剪成 meta + 截断 content 预览，方便肉眼判断是否保留 */
async function fetchOrphanPreview(id: string): Promise<{
  id: string;
  title: string;
  date: string;
  summary: string;
  createdAt: string;
  contentPreview: string;
} | null> {
  const raw = await kv.get<Doc>(`doc:${id}`);
  if (!raw || !isValidDoc(raw)) return null;

  /* content 可能是 gzip 压缩的 base64（带 __gz__ 前缀），直接截前 200 个字符够判断用
   * 不在这里解压是因为只是给人看的预览，省一次 cpu 开销 */
  const contentPreview = (raw.content ?? "").slice(0, 200);

  /* id 是 Date.now() 时间戳字符串，转一下便于辨认哪次上传 */
  const createdAt = /^\d{10,}$/.test(raw.id)
    ? new Date(Number(raw.id)).toISOString()
    : "unknown";

  return {
    id: raw.id,
    title: raw.title,
    date: raw.date ?? "",
    summary: raw.summary ?? "",
    createdAt,
    contentPreview,
  };
}

/* ---------- 主入口 ---------- */

export async function POST(req: NextRequest) {
  /* 鉴权：沿用项目其它 migrate 接口的 Bearer ADMIN_PASSWORD 模式 */
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = new URL(req.url).searchParams.get("mode") ?? "dryRun";
  if (!["dryRun", "restore", "purge"].includes(mode)) {
    return NextResponse.json(
      { error: `mode 必须是 dryRun / restore / purge，收到：${mode}` },
      { status: 400 },
    );
  }

  try {
    /* ---------- 1. 取两边 id 集合，做差集 ---------- */
    const [indexRaw, docKeys] = await Promise.all([
      kv.get<DocMeta[]>(INDEX_KEY),
      scanAllDocKeys(),
    ]);
    const indexArr = Array.isArray(indexRaw) ? indexRaw : [];
    const indexIds = new Set(indexArr.map((m) => m.id));

    const docIds = new Set<string>();
    for (const k of docKeys) {
      const id = docIdFromKey(k);
      if (id) docIds.add(id);
    }

    /* 孤儿：内容有、索引里找不到 */
    const orphanIds = [...docIds].filter((id) => !indexIds.has(id));
    /* 悬空：索引提到、但内容已不存在（删文档时发生过异常？极少见） */
    const danglingIds = [...indexIds].filter((id) => !docIds.has(id));

    /* ---------- 2. 拉孤儿的 meta 预览，便于人工判断 ---------- */
    const orphanPreviews = await Promise.all(orphanIds.map(fetchOrphanPreview));
    const orphans = orphanPreviews.filter(
      (x): x is NonNullable<typeof x> => x !== null,
    );
    /* 按 id 倒序 = 时间倒序，最新的在前，方便你从上往下看 */
    orphans.sort((a, b) => Number(b.id) - Number(a.id));

    const summary = {
      docCount: docIds.size,
      indexCount: indexIds.size,
      orphanCount: orphans.length,
      danglingCount: danglingIds.length,
    };

    /* ---------- 3. dryRun：只返回清单 ---------- */
    if (mode === "dryRun") {
      return NextResponse.json({
        mode,
        ...summary,
        orphans,
        dangling: danglingIds,
        hint: "确认无误后用 ?mode=restore（加回索引）或 ?mode=purge（删内容）执行",
      });
    }

    /* ---------- 4. restore：孤儿加回索引 + 清理悬空 ---------- */
    if (mode === "restore") {
      /* 孤儿 doc 里的 meta 字段（不带 content）追加到索引 */
      const recovered: DocMeta[] = orphans.map((o) => ({
        id: o.id,
        title: o.title,
        date: o.date,
        summary: o.summary,
      }));

      /* 过滤掉悬空条目，合并孤儿，按 id 倒序，全量写回 */
      const cleanedIndex = indexArr.filter((m) => docIds.has(m.id));
      const nextIndex: DocMeta[] = [...cleanedIndex, ...recovered].sort(
        (a, b) => Number(b.id) - Number(a.id),
      );

      await kv.set(INDEX_KEY, nextIndex);
      revalidateTag(CACHE_TAG_INDEX);

      return NextResponse.json({
        mode,
        ...summary,
        restored: recovered.length,
        removedDangling: indexArr.length - cleanedIndex.length,
        finalIndexCount: nextIndex.length,
      });
    }

    /* ---------- 5. purge：孤儿 doc 内容删除 + 清理悬空 ---------- */
    if (mode === "purge") {
      /* 批量删孤儿 doc key */
      let purged = 0;
      if (orphanIds.length > 0) {
        await Promise.all(orphanIds.map((id) => kv.del(`doc:${id}`)));
        purged = orphanIds.length;
      }

      /* 顺手清掉索引里的悬空引用，保证最终对账干净 */
      let removedDangling = 0;
      if (danglingIds.length > 0) {
        const cleanedIndex = indexArr.filter((m) => docIds.has(m.id));
        removedDangling = indexArr.length - cleanedIndex.length;
        if (removedDangling > 0) {
          await kv.set(INDEX_KEY, cleanedIndex);
          revalidateTag(CACHE_TAG_INDEX);
        }
      }

      return NextResponse.json({
        mode,
        ...summary,
        purged,
        removedDangling,
      });
    }

    /* 不可达（前面已校验） */
    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  } catch (err) {
    console.error("[reconcile-index] 对账失败:", err);
    const msg = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
