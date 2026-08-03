/**
 * qBittorrent WebUI API v2 客户端。
 *
 * 版本差异（已核对 qBittorrent 源码 torrentscontroller.cpp）：
 *   - qB 5.x（WebAPI >= 2.11.0）只认 `stopped`，端点是 /torrents/start、/torrents/stop
 *   - qB 4.x 用 `paused`，端点是 /torrents/resume、/torrents/pause
 * add 时两个参数一起发（未知参数会被忽略），动作端点按版本分发并带 404 兜底。
 */

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
  completion_on: number;
  eta: number;
  num_seeds: number;
  num_leechs: number;
  ratio: number;
  downloaded: number;
  uploaded: number;
  amount_left: number;
}

export interface AddOptions {
  category?: string;
  tags?: string;
  savepath?: string;
  stopped?: boolean;
  autoTMM?: boolean;
  rename?: string;
  skipChecking?: boolean;
  contentLayout?: "Original" | "Subfolder" | "NoSubfolder";
  upLimit?: number;
  dlLimit?: number;
}

export type QbAction = "start" | "stop" | "delete" | "recheck";

export class QbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "QbError";
  }
}

export class QbClient {
  private sid: string | null = null;
  private loginPromise: Promise<void> | null = null;
  private webApiVersion: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  // ---------------------------------------------------------------- auth

  private async doLogin(): Promise<void> {
    // 用户名为空 = 依赖 qB 的「对本机/白名单免认证」，跳过登录
    if (!this.username) {
      this.sid = null;
      return;
    }

    const body = new URLSearchParams({ username: this.username, password: this.password });
    const res = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // qB 会校验 Referer，缺了直接 403
        Referer: this.baseUrl,
        Origin: this.baseUrl,
      },
      redirect: "manual",
    }).catch((err: Error) => {
      throw new QbError(`连不上 qBittorrent (${this.baseUrl}): ${err.message}`);
    });

    const text = (await res.text()).trim();
    if (res.status === 403) {
      throw new QbError("qBittorrent 拒绝登录：IP 可能已被临时封禁（连续失败会封 1 小时），或 Referer 校验未通过", 403);
    }
    if (!res.ok || text.toLowerCase().startsWith("fail")) {
      throw new QbError("qBittorrent 用户名或密码错误", 401);
    }

    const cookies = res.headers.getSetCookie?.() ?? [];
    const sid = cookies.map((c) => /(?:^|;\s*)SID=([^;]+)/.exec(c)?.[1]).find(Boolean);
    // 开了免认证时 qB 会回 Ok. 但不下发 SID，这是正常的
    this.sid = sid ?? null;
  }

  private async ensureAuth(): Promise<void> {
    if (this.sid) return;
    if (!this.loginPromise) {
      this.loginPromise = this.doLogin().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async request(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
    allowRetry = true,
  ): Promise<Response> {
    await this.ensureAuth();

    const { timeoutMs = 20_000, ...rest } = init;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const headers = new Headers(rest.headers);
      headers.set("Referer", this.baseUrl);
      if (this.sid) headers.set("Cookie", `SID=${this.sid}`);

      const res = await fetch(`${this.baseUrl}${path}`, { ...rest, headers, signal: ctl.signal });

      // 会话过期 → 重新登录一次
      if (res.status === 403 && allowRetry && this.username) {
        this.sid = null;
        clearTimeout(timer);
        return this.request(path, init, false);
      }
      return res;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw new QbError(`qBittorrent 请求超时: ${path}`);
      if (err instanceof QbError) throw err;
      throw new QbError(`qBittorrent 请求失败: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.request(path);
    if (!res.ok) throw new QbError(`qBittorrent ${res.status} ${res.statusText} @ ${path}`, res.status);
    return (await res.json()) as T;
  }

  private async text(path: string): Promise<string> {
    const res = await this.request(path);
    if (!res.ok) throw new QbError(`qBittorrent ${res.status} ${res.statusText} @ ${path}`, res.status);
    return (await res.text()).trim();
  }

  // ------------------------------------------------------------- version

  /** WebAPI >= 2.11.0 即 qB 5.x：改用 stopped / start / stop 这套命名 */
  private async isModernApi(): Promise<boolean> {
    if (this.webApiVersion === null) {
      this.webApiVersion = await this.text("/api/v2/app/webapiVersion").catch(() => "0.0.0");
    }
    return compareVersions(this.webApiVersion, "2.11.0") >= 0;
  }

  // ---------------------------------------------------------------- read

  appVersion(): Promise<string> {
    return this.text("/api/v2/app/version");
  }

  async categories(): Promise<string[]> {
    const raw = await this.json<Record<string, { name: string; savePath: string }>>("/api/v2/torrents/categories");
    return Object.keys(raw).sort((a, b) => a.localeCompare(b));
  }

  async tags(): Promise<string[]> {
    const raw = await this.json<string[]>("/api/v2/torrents/tags");
    return [...raw].sort((a, b) => a.localeCompare(b));
  }

  async defaultSavePath(): Promise<string> {
    const prefs = await this.json<{ save_path?: string }>("/api/v2/app/preferences");
    return prefs.save_path ?? "";
  }

  async transferInfo(): Promise<{ dlspeed: number; upspeed: number }> {
    const info = await this.json<{ dl_info_speed?: number; up_info_speed?: number }>("/api/v2/transfer/info");
    return { dlspeed: info.dl_info_speed ?? 0, upspeed: info.up_info_speed ?? 0 };
  }

  torrents(filter = "all", limit = 100): Promise<QbTorrent[]> {
    const qs = new URLSearchParams({ filter, sort: "added_on", reverse: "true", limit: String(limit) });
    return this.json<QbTorrent[]>(`/api/v2/torrents/info?${qs.toString()}`);
  }

  // ----------------------------------------------------------------- add

  private async buildAddForm(opts: AddOptions): Promise<FormData> {
    const form = new FormData();
    const modern = await this.isModernApi();

    if (opts.category) form.set("category", opts.category);
    if (opts.tags) form.set("tags", opts.tags);
    if (opts.savepath) form.set("savepath", opts.savepath);
    if (opts.rename) form.set("rename", opts.rename);
    if (opts.contentLayout) form.set("contentLayout", opts.contentLayout);
    if (opts.upLimit != null) form.set("upLimit", String(opts.upLimit));
    if (opts.dlLimit != null) form.set("dlLimit", String(opts.dlLimit));
    if (opts.skipChecking) form.set("skip_checking", "true");
    if (opts.autoTMM != null) form.set("autoTMM", String(opts.autoTMM));
    if (opts.stopped) form.set(modern ? "stopped" : "paused", "true");

    return form;
  }

  private async submitAdd(form: FormData, what: string): Promise<void> {
    const res = await this.request("/api/v2/torrents/add", { method: "POST", body: form, timeoutMs: 60_000 });
    const text = (await res.text()).trim();

    if (res.status === 415) throw new QbError(`qBittorrent 拒收：${what} 不是有效的种子文件`, 415);
    if (!res.ok) throw new QbError(`qBittorrent 添加失败 ${res.status}: ${text.slice(0, 200)}`, res.status);
    // 成功回 "Ok."，失败回 "Fails."
    if (text.toLowerCase().startsWith("fail")) {
      throw new QbError(`qBittorrent 添加失败（种子已存在、保存路径无权限、或分类不存在）`);
    }
  }

  async addTorrentFile(bytes: Uint8Array, filename: string, opts: AddOptions = {}): Promise<void> {
    const form = await this.buildAddForm(opts);
    // 复制到独立 ArrayBuffer，避免 Uint8Array 是某个大 buffer 的视图时把整块带上
    const blob = new Blob([bytes.slice()], { type: "application/x-bittorrent" });
    form.set("torrents", blob, filename);
    await this.submitAdd(form, filename);
  }

  async addTorrentUrl(url: string, opts: AddOptions = {}): Promise<void> {
    const form = await this.buildAddForm(opts);
    form.set("urls", url);
    await this.submitAdd(form, url);
  }

  // -------------------------------------------------------------- action

  async act(action: QbAction, hashes: string[], deleteFiles = false): Promise<void> {
    if (hashes.length === 0) return;
    const modern = await this.isModernApi();
    const joined = hashes.join("|");

    const paths: Record<QbAction, string> = {
      start: modern ? "/api/v2/torrents/start" : "/api/v2/torrents/resume",
      stop: modern ? "/api/v2/torrents/stop" : "/api/v2/torrents/pause",
      delete: "/api/v2/torrents/delete",
      recheck: "/api/v2/torrents/recheck",
    };

    const body = new URLSearchParams({ hashes: joined });
    if (action === "delete") body.set("deleteFiles", String(deleteFiles));

    const post = (path: string) =>
      this.request(path, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

    let res = await post(paths[action]);
    // 版本探测不准时的兜底：新旧端点互换再试一次
    if (res.status === 404 && (action === "start" || action === "stop")) {
      const fallback =
        action === "start"
          ? modern
            ? "/api/v2/torrents/resume"
            : "/api/v2/torrents/start"
          : modern
            ? "/api/v2/torrents/pause"
            : "/api/v2/torrents/stop";
      res = await post(fallback);
    }
    if (!res.ok) throw new QbError(`qBittorrent ${action} 失败 ${res.status}`, res.status);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
