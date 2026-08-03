import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AdapterError, type SiteAdapter } from "./adapters/index.js";
import { SESSION_COOKIE, issueSession, requireAuth, safeCompare, verifySession } from "./auth.js";
import type { Config } from "./config.js";
import { normalizeProwlarrRelease, TOP_CATEGORIES, type NormalizedRelease } from "./normalize.js";
import { ProwlarrClient, ProwlarrError, type ProwlarrIndexer } from "./prowlarr.js";
import { QbClient, QbError } from "./qbit.js";

interface Deps {
  config: Config;
  prowlarr: ProwlarrClient;
  qb: QbClient;
  adapters: SiteAdapter[];
}

/**
 * 一个可搜索的来源。Prowlarr 里的站点和原生适配器在这里被抹平成同一种东西，
 * 上层的并发扇出、SSE 流式返回、筛选都不需要区分两者。
 */
interface SearchSource {
  id: string;
  name: string;
  enabled: boolean;
  privacy: string;
  search(
    params: { query: string; categories?: number[]; limit: number },
    opts: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<NormalizedRelease[]>;
}

const PROWLARR_PREFIX = "p:";

/** indexer 列表变动很少，缓存 60s，免得每次搜索都多打一次 Prowlarr */
class IndexerCache {
  private value: ProwlarrIndexer[] | null = null;
  private at = 0;
  constructor(
    private readonly client: ProwlarrClient,
    private readonly ttlMs = 60_000,
  ) {}

  async get(force = false): Promise<ProwlarrIndexer[]> {
    if (!force && this.value && Date.now() - this.at < this.ttlMs) return this.value;
    this.value = await this.client.listIndexers();
    this.at = Date.now();
    return this.value;
  }
}

const idList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const searchQuery = z.object({
  q: z.string().trim().min(1, "关键词不能为空").max(200),
  indexerIds: idList,
  categories: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
});

const addBody = z.object({
  source: z.string().min(1),
  siteId: z.string().max(64).optional().nullable(),
  downloadUrl: z.string().url().optional().nullable(),
  magnetUrl: z.string().optional().nullable(),
  title: z.string().default("torrent"),
  category: z.string().optional(),
  tags: z.string().optional(),
  savepath: z.string().optional(),
  stopped: z.boolean().optional(),
  autoTMM: z.boolean().optional(),
});

const actionBody = z.object({
  action: z.enum(["start", "stop", "delete", "recheck"]),
  hashes: z.array(z.string().min(6)).min(1).max(200),
  deleteFiles: z.boolean().default(false),
});

export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { config, prowlarr, qb, adapters } = deps;
  const indexers = new IndexerCache(prowlarr);
  const auth = { preHandler: requireAuth(config.SESSION_SECRET) };
  const adapterById = new Map(adapters.map((a) => [a.id, a]));

  const adapterSources = (): SearchSource[] =>
    adapters.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: true,
      privacy: "private",
      search: (params, opts) => a.search(params, opts),
    }));

  /** Prowlarr 站点 + 原生适配器，合成统一的来源列表 */
  const allSources = async (force = false): Promise<SearchSource[]> => {
    const list = await indexers.get(force);
    const fromProwlarr: SearchSource[] = list
      .filter((i) => i.protocol === "torrent")
      .map((i) => ({
        id: `${PROWLARR_PREFIX}${i.id}`,
        name: i.name,
        enabled: i.enable,
        privacy: i.privacy,
        search: (params, opts) =>
          prowlarr.search(i.id, i.name, params, opts).then((rs) => rs.map(normalizeProwlarrRelease)),
      }));

    return [...adapterSources(), ...fromProwlarr].sort((a, b) => a.name.localeCompare(b.name));
  };

  const searchTargets = async (wanted: string[]): Promise<SearchSource[]> => {
    const pool = (await allSources()).filter((s) => s.enabled);
    if (wanted.length === 0) return pool;
    const want = new Set(wanted);
    return pool.filter((s) => want.has(s.id));
  };

  // ------------------------------------------------------------- 认证

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const body = z.object({ password: z.string() }).safeParse(req.body);
      if (!body.success || !safeCompare(body.data.password, config.APP_PASSWORD)) {
        return reply.code(401).send({ error: "密码错误" });
      }
      reply.setCookie(SESSION_COOKIE, issueSession(config.SESSION_SECRET, config.SESSION_DAYS), {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: "auto",
        maxAge: config.SESSION_DAYS * 86_400,
      });
      return { ok: true };
    },
  );

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({
    authenticated: verifySession(req.cookies[SESSION_COOKIE], config.SESSION_SECRET),
  }));

  // --------------------------------------------------------- 站点 / 分类

  app.get("/api/indexers", auth, async (req) => {
    const force = (req.query as { refresh?: string })?.refresh === "1";
    const sources = await allSources(force);
    return {
      categories: TOP_CATEGORIES,
      indexers: sources.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        privacy: s.privacy,
        native: !s.id.startsWith(PROWLARR_PREFIX),
      })),
    };
  });

  // ------------------------------------------------------------- 搜索

  /**
   * 逐站并发搜索并用 SSE 逐个回吐结果。
   * 手机上等 10 个站全部返回太慢，先到的先看。
   */
  app.get("/api/search/stream", auth, async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "参数错误" });
    }
    const { q, indexerIds, categories } = parsed.data;

    const targets = await searchTargets(indexerIds);
    if (targets.length === 0) {
      return reply.code(400).send({ error: "没有可用的站点，请先在 Prowlarr 里添加并启用 indexer" });
    }

    const ctl = new AbortController();
    req.raw.on("close", () => ctl.abort());

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关掉 nginx 缓冲，否则 SSE 会被攒着一次性吐出来
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // iOS Safari 会掐掉长时间静默的连接
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n");
    }, 15_000);

    send("start", { indexers: targets.map((s) => ({ id: s.id, name: s.name })) });

    let done = 0;
    await Promise.all(
      targets.map(async (source) => {
        try {
          const releases = await source.search(
            { query: q, categories, limit: config.SEARCH_LIMIT },
            { signal: ctl.signal, timeoutMs: config.SEARCH_TIMEOUT_MS },
          );
          send("results", { indexerId: source.id, indexer: source.name, releases });
        } catch (err) {
          req.log.warn({ indexer: source.name, err }, "站点搜索失败");
          send("error", {
            indexerId: source.id,
            indexer: source.name,
            message: errMessage(err, "搜索失败"),
          });
        } finally {
          send("progress", { done: ++done, total: targets.length });
        }
      }),
    );

    clearInterval(heartbeat);
    send("done", { total: targets.length });
    reply.raw.end();
    return reply;
  });

  /** 一次性返回全部结果，给不支持 SSE 的场景兜底 */
  app.get("/api/search", auth, async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "参数错误" });
    }
    const { q, indexerIds, categories } = parsed.data;
    const targets = await searchTargets(indexerIds);

    const settled = await Promise.allSettled(
      targets.map((s) =>
        s.search({ query: q, categories, limit: config.SEARCH_LIMIT }, { timeoutMs: config.SEARCH_TIMEOUT_MS }),
      ),
    );

    const releases: NormalizedRelease[] = [];
    const errors: Array<{ indexer: string; message: string }> = [];
    settled.forEach((r, idx) => {
      const name = targets[idx]?.name ?? "unknown";
      if (r.status === "fulfilled") releases.push(...r.value);
      else errors.push({ indexer: name, message: errMessage(r.reason, "搜索失败") });
    });

    releases.sort((a, b) => b.seeders - a.seeders);
    return { releases, errors, searched: targets.length };
  });

  // ------------------------------------------------------- 推送到 qB

  app.post("/api/download", auth, async (req, reply) => {
    const parsed = addBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "参数错误" });
    }
    const b = parsed.data;

    const opts = {
      // 前端传了空串 = 用户主动清空，尊重它；只有 undefined 才回落到默认值
      category: b.category ?? (config.QB_DEFAULT_CATEGORY || undefined),
      tags: b.tags ?? (config.QB_DEFAULT_TAGS || undefined),
      savepath: b.savepath ?? (config.QB_DEFAULT_SAVEPATH || undefined),
      stopped: b.stopped ?? false,
      autoTMM: b.autoTMM,
    };

    try {
      const adapter = adapterById.get(b.source);

      if (adapter) {
        // 原生适配器：种子地址是带时效的，必须现取
        if (!b.siteId) return reply.code(400).send({ error: "缺少站点种子 id" });
        const { bytes, filename } = await adapter.fetchTorrent(b.siteId);
        await qb.addTorrentFile(bytes, filename, opts);
      } else if (b.source.startsWith(PROWLARR_PREFIX)) {
        if (b.downloadUrl) {
          // 注意：这里不校验 downloadUrl 的 origin。Prowlarr 在 Docker 里常常
          // 自报一个错的对外地址，校验相等会把正常下载全挡掉。
          // fetchTorrentFile 会把 origin 强制改写成已配置的 Prowlarr，
          // 服务端因此只可能访问该主机，SSRF 由结构保证而非校验保证。
          // 关键：必须由后端把种子字节取回来再上传给 qB。
          // 直接把 URL 丢给 qB 是不行的 —— qB 没有 PT 站的 Cookie / passkey。
          const { bytes, filename } = await prowlarr.fetchTorrentFile(b.downloadUrl);
          await qb.addTorrentFile(bytes, filename, opts);
        } else if (b.magnetUrl) {
          await qb.addTorrentUrl(b.magnetUrl, opts);
        } else {
          return reply.code(400).send({ error: "缺少 downloadUrl 或 magnetUrl" });
        }
      } else {
        return reply.code(400).send({ error: `未知的来源: ${b.source}` });
      }

      return { ok: true, title: b.title };
    } catch (err) {
      req.log.error({ err }, "推送到 qBittorrent 失败");
      return reply.code(502).send({ error: errMessage(err, "推送失败") });
    }
  });

  // ----------------------------------------------------------- 下载器

  app.get("/api/qb/summary", auth, async (_req, reply) => {
    const [version, categories, tags, savePath, transfer] = await Promise.allSettled([
      qb.appVersion(),
      qb.categories(),
      qb.tags(),
      qb.defaultSavePath(),
      qb.transferInfo(),
    ]);

    if (version.status === "rejected") {
      return reply.code(502).send({ error: errMessage(version.reason, "连不上 qBittorrent") });
    }
    return {
      version: version.value,
      categories: categories.status === "fulfilled" ? categories.value : [],
      tags: tags.status === "fulfilled" ? tags.value : [],
      defaultSavePath: savePath.status === "fulfilled" ? savePath.value : "",
      transfer: transfer.status === "fulfilled" ? transfer.value : { dlspeed: 0, upspeed: 0 },
      defaults: {
        category: config.QB_DEFAULT_CATEGORY,
        tags: config.QB_DEFAULT_TAGS,
        savepath: config.QB_DEFAULT_SAVEPATH,
      },
    };
  });

  app.get("/api/qb/torrents", auth, async (req, reply) => {
    const filter = (req.query as { filter?: string })?.filter ?? "all";
    try {
      return { torrents: await qb.torrents(filter, 100) };
    } catch (err) {
      return reply.code(502).send({ error: errMessage(err, "加载失败") });
    }
  });

  app.post("/api/qb/action", auth, async (req, reply) => {
    const parsed = actionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "参数错误" });
    }
    try {
      await qb.act(parsed.data.action, parsed.data.hashes, parsed.data.deleteFiles);
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: errMessage(err, "操作失败") });
    }
  });

  // ------------------------------------------------------------- 健康

  app.get("/api/health", async () => {
    const [p, q, ...nat] = await Promise.allSettled([
      prowlarr.listIndexers(),
      qb.appVersion(),
      ...adapters.map((a) => a.test()),
    ]);

    return {
      ok: p.status === "fulfilled" && q.status === "fulfilled" && nat.every((r) => r.status === "fulfilled"),
      prowlarr:
        p.status === "fulfilled"
          ? { ok: true, indexers: p.value.filter((i) => i.enable).length }
          : { ok: false, error: errMessage(p.reason, "连不上 Prowlarr") },
      qbittorrent:
        q.status === "fulfilled"
          ? { ok: true, version: q.value }
          : { ok: false, error: errMessage(q.reason, "连不上 qBittorrent") },
      native: adapters.map((a, i) => {
        const r = nat[i];
        return r?.status === "fulfilled"
          ? { id: a.id, name: a.name, ok: true }
          : { id: a.id, name: a.name, ok: false, error: errMessage(r?.reason, "自检失败") };
      }),
    };
  });
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ProwlarrError || err instanceof QbError || err instanceof AdapterError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
