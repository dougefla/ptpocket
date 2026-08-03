import type { ProwlarrRelease } from "./prowlarr.js";

/**
 * 优惠标签按 NexusPHP 的习惯显示「实际计多少下载量」：
 *   downloadFactor 0    -> 免费
 *   downloadFactor 0.3  -> 30%
 *   downloadFactor 0.5  -> 50%
 *   downloadFactor 1    -> 无标签
 */
export function discountLabel(factor: number | null): string | null {
  if (factor == null || factor >= 1) return null;
  if (factor <= 0) return "FREE";
  return `${Math.round(factor * 100)}%`;
}

export interface NormalizedRelease {
  id: string;
  /** 来源：Prowlarr 站点为 "p:<indexerId>"，原生适配器为其自身 id（如 "mteam"） */
  source: string;
  /** 站点侧的种子 id，原生适配器下载时要用 */
  siteId: string | null;
  title: string;
  /** 副标题（国内站的中文描述行），Prowlarr 侧一般没有 */
  subtitle: string | null;
  indexer: string;
  size: number;
  seeders: number;
  leechers: number;
  grabs: number;
  files: number | null;
  publishDate: string;
  ageHours: number;
  /** 计费比例：0 = 完全免费，1 = 正常计量 */
  downloadFactor: number;
  /** 上传倍率：2 = 2x 上传 */
  uploadFactor: number;
  /** 展示用优惠标签，无优惠时为 null */
  discountLabel: string | null;
  /** 优惠到期时间（ISO），拿不到则为 null */
  discountEndTime: string | null;
  /** HR 要求：最低分享率 */
  minimumRatio: number | null;
  /** HR 要求：最低做种时长（秒） */
  minimumSeedTime: number | null;
  hasHr: boolean;
  tags: string[];
  /** 顶级分类 id（2000 电影 / 5000 剧集 ...），用于筛选 */
  topCategory: number | null;
  infoUrl: string | null;
  /** .torrent 下载地址（Prowlarr 代理）。原生适配器为 null，下载时现取。 */
  downloadUrl: string | null;
  magnetUrl: string | null;
  infoHash: string | null;
}

export function normalizeProwlarrRelease(r: ProwlarrRelease): NormalizedRelease {
  const isMagnet = !!r.link?.startsWith("magnet:");

  // 只认 Newznab 标准区段（1000–8999）；国内站的自定义分类常在 100000+，忽略
  const tops = r.categories.map((id) => Math.floor(id / 1000) * 1000).filter((n) => n >= 1000 && n <= 8000);
  const leechers = r.peers != null && r.seeders != null ? Math.max(0, r.peers - r.seeders) : 0;
  const source = `p:${r.indexerId}`;

  return {
    // guid 在个别站会重复，拼上 source 保证前端 key 唯一
    id: `${source}:${r.guid}`,
    source,
    siteId: null,
    title: r.title,
    subtitle: null,
    indexer: r.indexer,
    size: r.size,
    seeders: r.seeders ?? 0,
    leechers,
    grabs: r.grabs ?? 0,
    files: r.files,
    publishDate: r.publishDate,
    ageHours: r.ageHours,
    downloadFactor: r.downloadVolumeFactor ?? 1,
    uploadFactor: r.uploadVolumeFactor ?? 1,
    discountLabel: discountLabel(r.downloadVolumeFactor),
    discountEndTime: null,
    minimumRatio: r.minimumRatio,
    minimumSeedTime: r.minimumSeedTime,
    hasHr: (r.minimumRatio ?? 0) > 0 || (r.minimumSeedTime ?? 0) > 0,
    tags: r.tags,
    topCategory: tops.length ? Math.min(...tops) : null,
    infoUrl: r.infoUrl,
    downloadUrl: isMagnet ? null : r.link,
    magnetUrl: isMagnet ? r.link : null,
    infoHash: r.infoHash,
  };
}

export const TOP_CATEGORIES: Array<{ id: number; name: string }> = [
  { id: 2000, name: "电影" },
  { id: 5000, name: "剧集" },
  { id: 3000, name: "音乐" },
  { id: 7000, name: "图书" },
  { id: 4000, name: "软件" },
  { id: 1000, name: "游戏" },
  { id: 6000, name: "其他" },
  { id: 8000, name: "杂项" },
];
