import { XMLParser } from "fast-xml-parser";

/**
 * Prowlarr 客户端。
 *
 * 搜索走的是 **Torznab** 端点（/api/v1/indexer/{id}/newznab），不是 /api/v1/search。
 * 理由（已对 Prowlarr develop 源码核实）：
 *   - ReleaseResource.ToResource() 只映射 IndexerFlags，不含 DownloadVolumeFactor；
 *     而 CardigannParser 只把 downloadvolumefactor 写进 TorrentInfo，从不转成 flag。
 *     结果就是 JSON 搜索接口里 **拿不到免费/优惠状态** —— 对国内 NexusPHP 站是致命的。
 *   - NewznabResults.ToXml() 则完整输出 downloadvolumefactor、uploadvolumefactor、
 *     minimumratio、minimumseedtime（HR 判断依据）、seeders、peers、infohash 等。
 * 所以 Torznab 是唯一能拿全字段的路径。
 */

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: "torrent" | "usenet";
  privacy: string;
  language?: string;
}

export interface ProwlarrRelease {
  guid: string;
  title: string;
  description: string | null;
  indexerId: number;
  indexer: string;
  infoUrl: string | null;
  /** Prowlarr 代理过的 .torrent 地址，或 magnet: 链接 */
  link: string | null;
  publishDate: string;
  ageHours: number;
  size: number;
  categories: number[];
  seeders: number | null;
  peers: number | null;
  grabs: number | null;
  files: number | null;
  infoHash: string | null;
  downloadVolumeFactor: number | null;
  uploadVolumeFactor: number | null;
  /** HR：最低分享率要求 */
  minimumRatio: number | null;
  /** HR：最低做种时长，单位秒 */
  minimumSeedTime: number | null;
  /** indexer 自带的 tag（internal / scene ...） */
  tags: string[];
}

export class ProwlarrError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProwlarrError";
  }
}

export interface SearchParams {
  query: string;
  categories?: number[];
  limit?: number;
  offset?: number;
  /** search / tvsearch / movie ... 取决于站点 caps */
  type?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // 去掉 torznab: 前缀，item 里的 <torznab:attr> 直接变成 attr
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name, jpath) =>
    jpath === "rss.channel.item" || jpath === "rss.channel.item.category" || jpath === "rss.channel.item.attr",
});

interface XmlAttr {
  "@name"?: string;
  "@value"?: string;
}

interface XmlItem {
  title?: string;
  description?: string;
  guid?: string | { "#text"?: string };
  comments?: string;
  pubDate?: string;
  size?: string;
  link?: string;
  category?: Array<string>;
  attr?: XmlAttr[];
  prowlarrindexer?: { "@id"?: string; "#text"?: string } | string;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as { "#text"?: unknown })["#text"] ?? "");
  }
  return String(v);
}

export class ProwlarrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async fetchWithTimeout(
    path: string,
    opts: { signal?: AbortSignal; timeoutMs?: number; accept?: string } = {},
  ): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        signal: ctl.signal,
        headers: { "X-Api-Key": this.apiKey, Accept: opts.accept ?? "application/json" },
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new ProwlarrError(`Prowlarr 请求超时（${timeoutMs}ms）: ${path}`);
      }
      throw new ProwlarrError(`Prowlarr 连接失败: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async listIndexers(signal?: AbortSignal): Promise<ProwlarrIndexer[]> {
    const res = await this.fetchWithTimeout("/api/v1/indexer", { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProwlarrError(`Prowlarr ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as ProwlarrIndexer[];
  }

  /** 搜单个站点。Torznab 是 per-indexer 的，聚合在上层做。 */
  async search(
    indexerId: number,
    indexerName: string,
    params: SearchParams,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<ProwlarrRelease[]> {
    const qs = new URLSearchParams({
      t: params.type ?? "search",
      q: params.query,
      extended: "1",
      limit: String(params.limit ?? 100),
      offset: String(params.offset ?? 0),
    });
    if (params.categories?.length) qs.set("cat", params.categories.join(","));

    const res = await this.fetchWithTimeout(`/api/v1/indexer/${indexerId}/newznab?${qs.toString()}`, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      accept: "application/xml",
    });

    const body = await res.text();
    if (!res.ok) {
      throw new ProwlarrError(extractXmlError(body) ?? `Prowlarr ${res.status} ${res.statusText}`, res.status);
    }
    return this.parseFeed(body, indexerId, indexerName);
  }

  private parseFeed(xml: string, fallbackId: number, fallbackName: string): ProwlarrRelease[] {
    let doc: { rss?: { channel?: { item?: XmlItem[] } }; error?: { "@description"?: string } };
    try {
      doc = parser.parse(xml) as typeof doc;
    } catch {
      throw new ProwlarrError("Prowlarr 返回了无法解析的 XML");
    }

    if (doc.error) throw new ProwlarrError(doc.error["@description"] ?? "Prowlarr 返回错误");

    const items = doc.rss?.channel?.item ?? [];
    const now = Date.now();

    return items.map((item) => {
      const attrs = new Map<string, string>();
      for (const a of item.attr ?? []) {
        if (a["@name"]) attrs.set(a["@name"].toLowerCase(), a["@value"] ?? "");
      }

      const published = item.pubDate ? new Date(item.pubDate) : new Date(now);
      const ts = Number.isNaN(published.getTime()) ? now : published.getTime();

      const idxRaw = item.prowlarrindexer;
      const indexerName = typeof idxRaw === "object" ? text(idxRaw) || fallbackName : (idxRaw ?? fallbackName);
      const indexerId =
        typeof idxRaw === "object" && idxRaw?.["@id"] ? (num(idxRaw["@id"]) ?? fallbackId) : fallbackId;

      const seeders = num(attrs.get("seeders"));
      const peers = num(attrs.get("peers"));
      const link = item.link || null;

      return {
        guid: text(item.guid) || link || `${indexerId}:${item.title ?? ""}`,
        title: item.title ?? "(无标题)",
        description: item.description || null,
        indexerId,
        indexer: indexerName,
        infoUrl: item.comments || null,
        link,
        publishDate: new Date(ts).toISOString(),
        ageHours: Math.max(0, (now - ts) / 3_600_000),
        size: num(item.size) ?? 0,
        categories: (item.category ?? []).map((c) => num(c) ?? 0).filter((n) => n > 0),
        seeders,
        peers,
        grabs: num(attrs.get("grabs")),
        files: num(attrs.get("files")),
        infoHash: attrs.get("infohash") || null,
        downloadVolumeFactor: num(attrs.get("downloadvolumefactor")),
        uploadVolumeFactor: num(attrs.get("uploadvolumefactor")),
        minimumRatio: num(attrs.get("minimumratio")),
        minimumSeedTime: num(attrs.get("minimumseedtime")),
        tags: (item.attr ?? [])
          .filter((a) => a["@name"]?.toLowerCase() === "tag" && a["@value"])
          .map((a) => a["@value"] as string),
      } satisfies ProwlarrRelease;
    });
  }

  /**
   * 把下载地址的 origin 强制改写成我们配置的 Prowlarr 地址，只保留 path + query。
   *
   * 两个作用，缺一不可：
   * 1. Prowlarr 给出的地址用的是它 *自己认为* 的对外地址，Docker 里常是错的
   *    （比如 localhost:9696），必须纠正才能取到种子。
   * 2. 这个地址是前端回传的。既然 origin 一律被覆盖成已配置的 Prowlarr，
   *    服务端就不可能被诱导去请求任意主机 —— SSRF 在结构上被排除，
   *    而不是靠「校验 origin 相等」（那样会和第 1 点直接冲突）。
   */
  private rewriteOrigin(rawUrl: string): string {
    const target = new URL(this.baseUrl);
    const url = new URL(rawUrl, this.baseUrl);
    url.protocol = target.protocol;
    url.host = target.host;
    // 顺手清掉 URL 里夹带的凭据，避免被用来对 Prowlarr 做认证尝试
    url.username = "";
    url.password = "";
    return url.toString();
  }

  /** 拉取 .torrent 字节流。Prowlarr 会带站点 Cookie 去取，我们只需带 apikey。 */
  async fetchTorrentFile(
    downloadUrl: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    let url: string;
    try {
      url = this.rewriteOrigin(downloadUrl);
    } catch {
      throw new ProwlarrError("下载地址不合法");
    }
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    if (opts.signal) opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });

    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: "follow",
        headers: { "X-Api-Key": this.apiKey },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProwlarrError(`下载种子失败 ${res.status}: ${body.slice(0, 200)}`, res.status);
      }

      const ctype = res.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await res.arrayBuffer());

      // 站点掉登录态时 Prowlarr 常常回 200 + HTML 登录页。必须在这里挡掉，
      // 否则 qBittorrent 只会回一句没头没尾的 "Fails."
      if (buf.length === 0 || buf[0] !== 0x64 /* bencode dict 以 'd' 开头 */) {
        if (ctype.includes("text/html") || ctype.includes("application/json")) {
          throw new ProwlarrError("拿到的不是种子文件（多半是站点掉登录态返回了 HTML），请到 Prowlarr 里更新 Cookie");
        }
        throw new ProwlarrError("返回内容不是合法的 .torrent 文件");
      }

      return { bytes: buf, filename: parseFilename(res.headers.get("content-disposition")) };
    } catch (err) {
      if (err instanceof ProwlarrError) throw err;
      if ((err as Error)?.name === "AbortError") throw new ProwlarrError("下载种子超时");
      throw new ProwlarrError(`下载种子失败: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractXmlError(body: string): string | null {
  const m = /<error[^>]*description="([^"]*)"/i.exec(body);
  return m?.[1] ?? null;
}

function parseFilename(disposition: string | null): string {
  if (!disposition) return "download.torrent";
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return sanitize(decodeURIComponent(star[1].replace(/^["']|["']$/g, "")));
    } catch {
      /* 编码坏了就走下面的 plain 分支 */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (plain?.[1]) return sanitize(plain[1]);
  return "download.torrent";
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "_").trim();
  if (!cleaned) return "download.torrent";
  return cleaned.toLowerCase().endsWith(".torrent") ? cleaned : `${cleaned}.torrent`;
}
