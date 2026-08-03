export interface Release {
  id: string;
  /** 来源标识：Prowlarr 站点为 "p:<id>"，原生适配器为其 id（如 "mteam"） */
  source: string;
  siteId: string | null;
  title: string;
  subtitle: string | null;
  indexer: string;
  size: number;
  seeders: number;
  leechers: number;
  grabs: number;
  files: number | null;
  publishDate: string;
  ageHours: number;
  downloadFactor: number;
  uploadFactor: number;
  discountLabel: string | null;
  discountEndTime: string | null;
  minimumRatio: number | null;
  minimumSeedTime: number | null;
  hasHr: boolean;
  tags: string[];
  topCategory: number | null;
  infoUrl: string | null;
  downloadUrl: string | null;
  magnetUrl: string | null;
  infoHash: string | null;
}

export interface Indexer {
  id: string;
  name: string;
  enabled: boolean;
  privacy: string;
  /** true = 原生适配器（不经 Prowlarr） */
  native: boolean;
}

export interface QbTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  state: string;
  category: string;
  tags: string;
  save_path: string;
  added_on: number;
  eta: number;
  num_seeds: number;
  num_leechs: number;
  ratio: number;
  amount_left: number;
}

export interface QbSummary {
  version: string;
  categories: string[];
  tags: string[];
  defaultSavePath: string;
  transfer: { dlspeed: number; upspeed: number };
  defaults: { category: string; tags: string; savepath: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 401 时广播出去，App.vue 收到就踢回登录页 */
export const authLost = new EventTarget();

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("网络连接失败", 0);
  }

  if (res.status === 401) {
    authLost.dispatchEvent(new Event("lost"));
    throw new ApiError("未登录", 401);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* 非 JSON 响应，下面按状态码处理 */
    }
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `请求失败 (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export interface DownloadPayload {
  source: string;
  siteId?: string | null;
  downloadUrl?: string | null;
  magnetUrl?: string | null;
  title: string;
  category?: string;
  tags?: string;
  savepath?: string;
  stopped?: boolean;
}

export const api = {
  login: (password: string) => req<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => req<{ authenticated: boolean }>("/api/auth/me"),

  indexers: (refresh = false) =>
    req<{ indexers: Indexer[]; categories: Array<{ id: number; name: string }> }>(
      `/api/indexers${refresh ? "?refresh=1" : ""}`,
    ),

  download: (payload: DownloadPayload) =>
    req<{ ok: true; title: string }>("/api/download", { method: "POST", body: JSON.stringify(payload) }),

  qbSummary: () => req<QbSummary>("/api/qb/summary"),
  qbTorrents: (filter = "all") => req<{ torrents: QbTorrent[] }>(`/api/qb/torrents?filter=${encodeURIComponent(filter)}`),
  qbAction: (action: "start" | "stop" | "delete" | "recheck", hashes: string[], deleteFiles = false) =>
    req<{ ok: true }>("/api/qb/action", { method: "POST", body: JSON.stringify({ action, hashes, deleteFiles }) }),

  health: () =>
    req<{
      ok: boolean;
      prowlarr: { ok: boolean; indexers?: number; error?: string };
      qbittorrent: { ok: boolean; version?: string; error?: string };
      native: Array<{ id: string; name: string; ok: boolean; error?: string }>;
    }>("/api/health"),
};

// --------------------------------------------------------------- 流式搜索

export interface SearchHandlers {
  onStart?: (indexers: Array<{ id: string; name: string }>) => void;
  onResults: (indexerId: string, indexer: string, releases: Release[]) => void;
  onIndexerError: (indexer: string, message: string) => void;
  onProgress?: (done: number, total: number) => void;
  onDone: () => void;
  onFatal: (message: string) => void;
}

/**
 * 逐站流式搜索。返回一个取消函数。
 * 用 EventSource 而不是 fetch+ReadableStream —— iOS Safari 上前者更稳，
 * 且同源请求会自动带上会话 cookie。
 */
export function searchStream(
  params: { q: string; indexerIds?: string[]; categories?: number[] },
  handlers: SearchHandlers,
): () => void {
  const qs = new URLSearchParams({ q: params.q });
  if (params.indexerIds?.length) qs.set("indexerIds", params.indexerIds.join(","));
  if (params.categories?.length) qs.set("categories", params.categories.join(","));

  const es = new EventSource(`/api/search/stream?${qs.toString()}`, { withCredentials: true });
  let finished = false;

  const close = () => {
    finished = true;
    es.close();
  };

  es.addEventListener("start", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { indexers: Array<{ id: string; name: string }> };
    handlers.onStart?.(d.indexers);
  });

  es.addEventListener("results", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { indexerId: string; indexer: string; releases: Release[] };
    handlers.onResults(d.indexerId, d.indexer, d.releases);
  });

  es.addEventListener("error", (e) => {
    // 带 data 的是单个站点失败；不带的是连接本身断了
    const raw = (e as MessageEvent).data;
    if (typeof raw === "string" && raw) {
      const d = JSON.parse(raw) as { indexer: string; message: string };
      handlers.onIndexerError(d.indexer, d.message);
    }
  });

  es.addEventListener("progress", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { done: number; total: number };
    handlers.onProgress?.(d.done, d.total);
  });

  es.addEventListener("done", () => {
    close();
    handlers.onDone();
  });

  es.onerror = () => {
    if (finished) return;
    // readyState=CLOSED 说明是真的断了（含 401），不会自动重连
    if (es.readyState === EventSource.CLOSED) {
      close();
      handlers.onFatal("搜索连接中断，请检查登录状态或后端服务");
    }
  };

  return close;
}
