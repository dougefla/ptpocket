import type { NormalizedRelease } from "../normalize.js";

/**
 * 原生站点适配器。
 *
 * 存在的理由：有些站 Prowlarr 覆盖不了。M-Team 就是典型 —— 它是 POST + JSON API +
 * x-api-key 令牌鉴权，Cardigann 的 HTML 抓取模型套不上，上游 Prowlarr / Jackett
 * 至今都没有它的定义。这类站在这里各写一个适配器，和 Prowlarr 的站点并列参与搜索。
 */
export interface SiteAdapter {
  /** 全局唯一，同时用作 source 标识（不能以 "p:" 开头，那是 Prowlarr 的命名空间） */
  readonly id: string;
  readonly name: string;

  search(
    params: { query: string; categories?: number[]; limit: number },
    opts: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<NormalizedRelease[]>;

  /** 按站点侧 id 取回 .torrent 字节流 */
  fetchTorrent(siteId: string, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{
    bytes: Uint8Array;
    filename: string;
  }>;

  /** 连通性 / 鉴权自检，健康检查用。失败请抛出带可操作信息的错误。 */
  test(): Promise<void>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/** 校验取回的内容确实是 bencode 编码的 .torrent，而不是 HTML 登录页 */
export function assertTorrentBytes(bytes: Uint8Array, contentType: string, siteName: string): void {
  if (bytes.length > 0 && bytes[0] === 0x64 /* 'd' */) return;
  if (contentType.includes("text/html") || contentType.includes("application/json")) {
    throw new AdapterError(`${siteName} 返回的不是种子文件（多半是令牌失效或权限不足）`);
  }
  throw new AdapterError(`${siteName} 返回的内容不是合法的 .torrent 文件`);
}
