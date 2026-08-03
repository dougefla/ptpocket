import { discountLabel, type NormalizedRelease } from "../normalize.js";
import { AdapterError, assertTorrentBytes, type SiteAdapter } from "./types.js";

/**
 * M-Team（馒头）适配器。
 *
 * 站点是纯 JSON API，与 NexusPHP 的 HTML 页面完全不同，所以 Prowlarr / Jackett
 * 的 Cardigann 定义库里没有它，只能原生对接。协议细节参考 PT-depiler 的
 * src/packages/site/definitions/mteam.ts（MIT）：
 *   - API 域名是把站点域名首段换成 api，例如 kp.m-team.cc -> api.m-team.cc
 *   - 所有接口一律 POST
 *   - 鉴权用 header `x-api-key: <存取令牌>`（控制台→实验室→存取令牌获取）
 *   - 站点 2025-10-28 起校验 Origin，必须带上
 *   - 搜索 POST /api/torrent/search，JSON body
 *   - 下载要两步：POST /api/torrent/genDlToken（multipart）拿到临时 URL，再去取字节
 */

const MODES = ["normal", "adult"] as const;
export type MTeamMode = (typeof MODES)[number] | "all";

/** M-Team 自有的优惠枚举 -> (计费比例, 上传倍率) */
const DISCOUNTS: Record<string, { dl: number; up: number }> = {
  NORMAL: { dl: 1, up: 1 },
  FREE: { dl: 0, up: 1 },
  PERCENT_50: { dl: 0.5, up: 1 },
  // PERCENT_70 = 优惠 70%，即只计 30% 下载量
  PERCENT_70: { dl: 0.3, up: 1 },
  _2X: { dl: 1, up: 2 },
  _2X_FREE: { dl: 0, up: 2 },
  _2X_PERCENT_50: { dl: 0.5, up: 2 },
};

/** 站点分类 -> Newznab 顶级分类，用于前端筛选条 */
const CATEGORY_TOP: Record<string, number> = {
  // 電影
  "401": 2000, "419": 2000, "420": 2000, "421": 2000, "439": 2000,
  // 影劇/綜藝/紀錄/動畫/運動
  "403": 5000, "402": 5000, "438": 5000, "435": 5000, "404": 5000, "405": 5000, "407": 5000,
  // 音樂
  "434": 3000, "406": 3000,
  // 遊戲
  "423": 4000, "448": 1000,
  // 書
  "427": 7000, "442": 7000,
  // 軟體
  "422": 4000,
  // 其他
  "451": 8000, "409": 8000,
  // 成人區
  "410": 6000, "424": 6000, "437": 6000, "431": 6000, "429": 6000, "430": 6000, "426": 6000,
  "432": 6000, "436": 6000, "440": 6000, "425": 6000, "433": 6000, "411": 6000, "412": 6000, "413": 6000,
};

interface MTeamResp<T> {
  code: string;
  message: string;
  data: T;
}

interface MTeamTorrent {
  id: string;
  name: string;
  smallDescr: string | null;
  createdDate: string;
  category: string;
  size: string;
  numfiles: string | null;
  labelsNew: string[] | null;
  status: {
    seeders: string;
    leechers: string;
    timesCompleted: string;
    discount: string | null;
    discountEndTime: string | null;
    toppingLevel: string | null;
    promotionRule: { discount?: string | null } | null;
    mallSingleFree: unknown;
  } | null;
}

export interface MTeamOptions {
  apiKey: string;
  /** 站点 web 域名，默认 https://kp.m-team.cc */
  siteUrl?: string;
  /** API 地址。留空则由 siteUrl 推导 */
  apiUrl?: string;
  mode?: MTeamMode;
}

export class MTeamAdapter implements SiteAdapter {
  readonly id = "mteam";
  readonly name = "M-Team";

  private readonly siteUrl: string;
  private readonly apiUrl: string;
  private readonly mode: MTeamMode;

  constructor(private readonly opts: MTeamOptions) {
    this.siteUrl = (opts.siteUrl ?? "https://kp.m-team.cc").replace(/\/+$/, "");
    this.apiUrl = opts.apiUrl ? opts.apiUrl.replace(/\/+$/, "") : toApiOrigin(this.siteUrl);
    this.mode = opts.mode ?? "normal";
  }

  // ---------------------------------------------------------------- 底层请求

  private async post<T>(
    path: string,
    body: string | FormData | null,
    contentType: string | null,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<MTeamResp<T>> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
    }

    const headers: Record<string, string> = {
      "x-api-key": this.opts.apiKey,
      // 2025-10-28 起站点会校验 Origin，缺了直接被拒
      Origin: this.siteUrl,
      Referer: `${this.siteUrl}/`,
      Accept: "application/json",
    };
    if (contentType) headers["Content-Type"] = contentType;

    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}${path}`, { method: "POST", body, headers, signal: ctl.signal });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new AdapterError(`M-Team 请求超时（${timeoutMs}ms）: ${path}`);
      }
      throw new AdapterError(`M-Team 连接失败: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new AdapterError("M-Team 拒绝访问：存取令牌无效或已过期，请到「控制台 → 实验室 → 存取令牌」重新生成", res.status);
    }
    if (!res.ok) {
      throw new AdapterError(`M-Team ${res.status} ${res.statusText}`, res.status);
    }

    let json: MTeamResp<T>;
    try {
      json = (await res.json()) as MTeamResp<T>;
    } catch {
      throw new AdapterError("M-Team 返回了无法解析的响应（可能是被 CDN 拦截）");
    }

    // 站点自身的成功标志，HTTP 200 不代表业务成功
    if (json.message !== "SUCCESS") {
      throw new AdapterError(`M-Team: ${json.message || "接口返回失败"}`);
    }
    return json;
  }

  // ------------------------------------------------------------------ 搜索

  async search(
    params: { query: string; categories?: number[]; limit: number },
    opts: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<NormalizedRelease[]> {
    const modes: Array<(typeof MODES)[number]> = this.mode === "all" ? [...MODES] : [this.mode];

    const batches = await Promise.all(
      modes.map((mode) =>
        this.post<{ data: MTeamTorrent[] | null }>(
          "/api/torrent/search",
          JSON.stringify({
            mode,
            keyword: params.query,
            pageNumber: 1,
            pageSize: Math.min(params.limit, 100),
          }),
          "application/json",
          opts,
        ).then((r) => r.data?.data ?? []),
      ),
    );

    return batches.flat().map((t) => this.toRelease(t));
  }

  private toRelease(t: MTeamTorrent): NormalizedRelease {
    const st = t.status;

    // 全站促销规则优先于单种促销，这点和 PT-depiler 的处理一致
    const rawDiscount =
      st?.promotionRule?.discount ?? (st?.mallSingleFree ? "FREE" : (st?.discount ?? "NORMAL"));
    const factors = DISCOUNTS[rawDiscount] ?? { dl: 1, up: 1 };

    // createdDate 形如 "2025-01-15 10:23:45"，站点时区为 UTC+8
    const published = parseSiteTime(t.createdDate);
    const ageHours = Math.max(0, (Date.now() - published.getTime()) / 3_600_000);

    const seeders = toInt(st?.seeders);
    const leechers = toInt(st?.leechers);

    const tags: string[] = [...(t.labelsNew ?? [])];
    if (st?.toppingLevel && st.toppingLevel !== "0") tags.push("置顶");

    return {
      id: `${this.id}:${t.id}`,
      source: this.id,
      siteId: t.id,
      title: t.name,
      subtitle: t.smallDescr || null,
      indexer: this.name,
      size: toInt(t.size),
      seeders,
      leechers,
      grabs: toInt(st?.timesCompleted),
      files: t.numfiles ? toInt(t.numfiles) : null,
      publishDate: published.toISOString(),
      ageHours,
      downloadFactor: factors.dl,
      uploadFactor: factors.up,
      discountLabel: discountLabel(factors.dl),
      discountEndTime: st?.discountEndTime ? parseSiteTime(st.discountEndTime).toISOString() : null,
      // M-Team 的搜索接口不返回 HR 信息
      minimumRatio: null,
      minimumSeedTime: null,
      hasHr: false,
      tags,
      topCategory: CATEGORY_TOP[t.category] ?? null,
      infoUrl: `${this.siteUrl}/detail/${t.id}`,
      downloadUrl: null, // 需要临时令牌，推送时现取
      magnetUrl: null,
      infoHash: null,
    };
  }

  // ------------------------------------------------------------------ 下载

  async fetchTorrent(
    siteId: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    if (!/^\d+$/.test(siteId)) throw new AdapterError("非法的 M-Team 种子 id");

    // 第一步：换取带时效的下载地址
    const form = new FormData();
    form.set("id", siteId);
    const token = await this.post<string>("/api/torrent/genDlToken", form, null, opts);

    const url = token.data;
    if (!url || !/^https?:\/\//.test(url)) {
      throw new AdapterError("M-Team 未返回有效的下载地址（可能是下载权限不足或已达并发上限）");
    }

    // 第二步：按地址取回种子字节
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    if (opts.signal) opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });

    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: "follow",
        headers: { "x-api-key": this.opts.apiKey, Origin: this.siteUrl, Referer: `${this.siteUrl}/` },
      });
      if (!res.ok) throw new AdapterError(`M-Team 下载种子失败 ${res.status}`, res.status);

      const bytes = new Uint8Array(await res.arrayBuffer());
      assertTorrentBytes(bytes, res.headers.get("content-type") ?? "", "M-Team");
      return { bytes, filename: `mteam-${siteId}.torrent` };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      if ((err as Error)?.name === "AbortError") throw new AdapterError("M-Team 下载种子超时");
      throw new AdapterError(`M-Team 下载种子失败: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ 自检

  async test(): Promise<void> {
    await this.post("/api/member/profile", null, null, { timeoutMs: 15_000 });
  }
}

/**
 * kp.m-team.cc -> https://api.m-team.cc
 *
 * 只在确实是域名时替换首段。IP 字面量和单段主机名（localhost、容器服务名）
 * 原样返回 —— 把 127.0.0.1 改写成 api.0.0.1 只会得到一个解析不了的地址。
 */
function toApiOrigin(siteUrl: string): string {
  try {
    const u = new URL(siteUrl);
    const host = u.hostname;
    const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const isIpv6 = host.includes(":") || host.startsWith("[");
    const parts = host.split(".");

    if (!isIpv4 && !isIpv6 && parts.length > 1) {
      parts[0] = "api";
      u.hostname = parts.join(".");
    }
    u.pathname = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return siteUrl.replace(/^(https?:\/\/)[^./]+\./, "$1api.");
  }
}

/** 站点返回 "2025-01-15 10:23:45" 这种无时区字符串，按 UTC+8 解释 */
function parseSiteTime(raw: string | null | undefined): Date {
  if (!raw) return new Date();
  const iso = raw.trim().replace(" ", "T");
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function toInt(v: string | null | undefined): number {
  const n = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}
