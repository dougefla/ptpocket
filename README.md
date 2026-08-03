# PT Pocket

自托管的 PT 聚合搜索 + qBittorrent 推送 PWA。装到 iPhone 主屏，全屏运行，无需上架 App Store。

- **搜索** — 一次查询并发扇出到所有 PT 站，结果**逐站流式返回**（先到先显示，不用等最慢的站）
- **推送** — 后端取回 `.torrent` 字节再上传给 qBittorrent，可指定分类 / 标签 / 保存路径 / 添加后暂停
- **管理** — 查看下载进度与速度，暂停 / 继续 / 校验 / 删除
- **国内站友好** — 正确显示 **免费 / 30% / 50% 优惠**、**2x 上传**、**H&R 要求**，支持「仅免费」「排除 HR」筛选
- **M-Team 原生支持** — 馒头是 API 站，Prowlarr 覆盖不了，本应用直接对接（见下）

```
iPhone 主屏 PWA
   │  HTTPS
   ▼
PT Pocket 后端 (Fastify)
   ├──► Prowlarr ─────────► PT 站 xN   (站点定义与 Cookie 由 Prowlarr 维护)
   ├──► 原生适配器 ────────► M-Team    (JSON API + 存取令牌，Prowlarr 不支持)
   └──► qBittorrent WebUI API
```

两条搜索路径在上层被抹平成同一种「来源」，扇出、流式返回、筛选、推送都不区分两者。

---

## 为什么必须有后端

纯前端 web app 做不到，三重硬阻断：

1. **CORS** — PT 站不会给你的域名下发 `Access-Control-Allow-Origin`，浏览器直接拦掉搜索请求。
2. **第三方 Cookie** — 即使 CORS 通过，从你的源发往 PT 站的是第三方 Cookie，iOS Safari 默认完全拦截。
3. **混合内容** — PWA 必须跑在 HTTPS 上，而家里的 qBittorrent 通常是 HTTP，浏览器会 block。

PT-depiler 之所以能工作，是因为它是**浏览器扩展**——扩展特权绕过 CORS 并直接复用浏览器里的登录态。iOS Safari 没有这个能力，所以换成「后端持有凭据 + PWA 当界面」的架构。

---

## 快速开始

### 1. 部署

```bash
git clone <你的仓库> ptpocket && cd ptpocket
cp .env.example .env
openssl rand -hex 32          # 把输出填进 .env 的 SESSION_SECRET
vi .env                       # 至少填 APP_PASSWORD / PROWLARR_API_KEY / QB_*
docker compose up -d --build
```

### 2. 配置 Prowlarr（关键一步）

打开 `http://<NAS_IP>:9696`：

1. **Settings → General → API Key** 复制出来，填进 `.env` 的 `PROWLARR_API_KEY`，然后 `docker compose up -d` 重启生效。
2. **Indexers → Add Indexer** 逐个添加你的站。国内 NexusPHP 站基本都是 **Cookie 登录**：
   - 浏览器登录站点 → F12 → Network → 任意请求 → Request Headers → 复制整条 `Cookie`
   - 粘贴到 indexer 的 Cookie 字段
   - 同时把 **User-Agent** 也填成同一个浏览器的，否则挂了 Cloudflare 的站会当异常请求拦掉
3. **Settings → Indexers → FlareSolverr**：Host 填 `http://flaresolverr:8191/`，用于过 Cloudflare 五秒盾。国内站建议开。
4. 每个 indexer 点 **Test**，绿勾才算通。

> Cookie 会过期（通常几周到几个月）。站点搜不出东西时，第一件事就是回来重填 Cookie。
> App 里如果推送时报「拿到的不是种子文件…掉登录态」，也是同一个原因。

### 3. 装到 iPhone 主屏

Safari 打开你的地址 → 底部**分享** → **添加到主屏幕**。之后从主屏图标启动即为全屏无地址栏。

> **必须 HTTPS**：Service Worker 和 PWA 安装都要求安全上下文（`localhost` 除外）。
> 内网 HTTP 也能用，但装不了主屏、离线不可用。见下面的 HTTPS 方案。

---

## HTTPS 方案（二选一）

**Cloudflare Tunnel（推荐，不用开端口、不用公网 IP）**

```yaml
# 加到 docker-compose.yml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    networks: [ptnet]
```
在 Cloudflare Zero Trust 建 Tunnel，Public Hostname 指向 `http://ptpocket:8787`。
**注意**：Tunnel 里必须保留 SSE 的流式传输（不要启用响应缓冲），否则搜索结果会攒到最后一次性吐出。

**已有 nginx 反代** —— SSE 需要额外关掉缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # SSE 必需
    proxy_read_timeout 300s;      # 搜索可能跑几十秒
}
```

---

## 站点覆盖：先看这里

Prowlarr 内置了 **47+ 个国内站**的定义，包括
hdsky、chdbits、ourbits、pterclub、totheglory、springsunday、audiences、hdhome、hddolby、
hdfans、hdarea、hdtime、haidan、tjupt、byrbt、hhanclub、pttime、pthome、opencd、
lemonhd、carpt、nicept、okpt、ubits、agsvpt、soulvoice、wintersakura、qingwa、zmpt 等。

### M-Team（馒头）—— 已原生支持，不用配 Prowlarr

M-Team 是**纯 JSON API 站**（POST + `x-api-key` 令牌），不是 NexusPHP 页面，
Cardigann 的 HTML 抓取模型套不上，所以 Prowlarr / Jackett 上游至今都没有它。
本应用为它写了原生适配器，直接对接：

1. 登录 M-Team → **控制台 → 实验室 → 存取令牌** → 生成令牌
2. 填进 `.env` 的 `MTEAM_API_KEY`，`docker compose up -d` 重启
3. 打开 App 的「设置」页，看到 **M-Team 令牌有效（原生接入）** 即成功

它和 Prowlarr 里的站点在搜索时完全平权——同一个搜索框、同一条流式返回、同一套
「仅免费」筛选。M-Team 自有的优惠枚举已完整映射：

| M-Team `discount` | 显示 | 计费 | 上传 |
|---|---|---|---|
| `FREE` | 免费 | 0 | 1x |
| `PERCENT_50` | 50% | 0.5 | 1x |
| `PERCENT_70` | 30% | 0.3 | 1x |
| `_2X` | — | 1 | 2x |
| `_2X_FREE` | 免费 | 0 | 2x |
| `_2X_PERCENT_50` | 50% | 0.5 | 2x |

额外还能拿到 Prowlarr 路径拿不到的东西：**中文副标题**（`smallDescr`，比英文主标题好认）
和**优惠剩余时间**（`discountEndTime`，卡片上直接显示「剩 2 天」）。全站促销规则
（`promotionRule`）优先于单种 `discount`，这点和 PT-depiler 的处理一致。

> M-Team 的搜索接口**不返回 HR 信息**，所以它的结果不会有 HR 标记——这不代表没有 HR，
> 需要确认请点「站点详情」。

### 其余上游没收录的站

> **HDChina、keepfrds、PTVicomo、GreatPosterWall、DicMusic、朱雀、ICC2022、HD4fans、NPUPT** 等

这些是 NexusPHP 页面站，可以自己写 Cardigann 定义，放进 Prowlarr 的自定义目录：

```bash
mkdir -p data/prowlarr/Definitions/Custom
# 把 .yml 放进去，然后重启 Prowlarr
docker compose restart prowlarr
```

写法可直接参考上游任一国内站定义作为模板（结构完全一致）：

```bash
curl -O https://raw.githubusercontent.com/Prowlarr/Indexers/master/definitions/v11/hdsky.yml
```

关键字段是 `downloadvolumefactor` / `uploadvolumefactor` 的 `case` 映射——**优惠标签全靠它**，
按目标站页面上免费图标的 CSS 选择器来写：

```yaml
    downloadvolumefactor:
      case:
        img.pro_free: 0            # 免费
        img.pro_free2up: 0         # 免费且 2x 上传
        img.pro_50pctdown: 0.5     # 50%
        img.pro_30pctdown: 0.3     # 30%
        "*": 1                     # 正常计量
    uploadvolumefactor:
      case:
        img.pro_2up: 2
        img.pro_free2up: 2
        "*": 1
```

社区有人维护这些缺失站点的定义，搜 “prowlarr 国内 PT 站 自定义定义 / custom definitions” 可以找到现成的。

如果某个站也是 API 站（Cardigann 写不出来），就照 `server/src/adapters/mteam.ts` 再加一个原生适配器：
实现 `SiteAdapter` 接口（`search` / `fetchTorrent` / `test`），在 `server/src/adapters/index.ts` 里注册即可，
搜索、筛选、推送、健康检查会自动把它当成一等公民。

---

## 一个重要的实现细节

搜索走的是 Prowlarr 的 **Torznab** 端点（`/api/v1/indexer/{id}/newznab`），**不是** `/api/v1/search`。

原因（已对 Prowlarr 源码核实）：`ReleaseResource.ToResource()` 只映射 `IndexerFlags`，
而 `CardigannParser` 只把 `downloadvolumefactor` 写进 `TorrentInfo`、从不转成 flag。
结果就是 **JSON 搜索接口里完全拿不到免费/优惠状态**——对国内站是致命的。
而 `NewznabResults.ToXml()` 完整输出 `downloadvolumefactor`、`uploadvolumefactor`、
`minimumratio`、`minimumseedtime`（H&R 依据）、`seeders`、`peers`、`infohash`。

所以 Torznab 是唯一能拿全字段的路径。如果哪天想加字段，先去那个 XML 里确认它存不存在。

---

## 本地开发

```bash
pnpm install
python3 web/scripts/gen-icons.py          # 改了图标设计才需要重跑

# 终端 1：后端（读同目录 .env）
cd server && set -a && . ../.env && set +a && pnpm dev

# 终端 2：前端（已代理 /api 到 :8787，且监听 0.0.0.0 便于手机联调）
pnpm --filter @ptpocket/web dev
```

手机同 WiFi 访问 `http://<电脑IP>:5173` 即可实时调试。

```bash
pnpm typecheck        # 前后端类型检查
pnpm build            # 产出 web/dist + server/dist
./test/run.sh         # 冒烟测试（83 项，用 mock 服务，不需要真实账号）
```

改了适配器或路由后务必跑一遍 `./test/run.sh`，细节见 [test/README.md](test/README.md)。

---

## 配置项

见 `.env.example`，全部环境变量都在那里，含中文说明。几个容易踩的：

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | 必须 ≥32 字符，改了会让所有已登录设备掉线 |
| `QB_USERNAME` | 留空表示依赖 qBittorrent 的「对本机/白名单免认证」 |
| `MTEAM_API_KEY` | 留空则不启用 M-Team；填了就自动出现在站点列表 |
| `SEARCH_TIMEOUT_MS` | 单站超时。挂 FlareSolverr 的站慢，可调到 60000+ |
| `TRUST_PROXY` | 在 Tunnel / nginx 后面必须 `true`，否则限流按反代 IP 算 |

---

## 已知限制

- **优惠是快照，没有倒计时** — 显示的是搜索那一刻的状态。临期免费种建议点「站点详情」核对。
- **HR 依赖站点定义** — 只有定义里写了 `minimumratio` / `minimumseedtime` 的站才显示 HR 标记；没写的站（含 M-Team）不代表没有 HR。
- **搜索不分页** — 每站取前 `SEARCH_LIMIT` 条（默认 100）。手机上翻更多意义不大。
- **单用户** — 一个密码一套配置，没有多用户/权限体系。
- **不做 RSS 订阅和自动追剧** — 那是 MoviePilot / Sonarr 的领域，这个 App 只解决「手机上搜一下、推过去」。

## 安全须知

这个服务持有你 PT 站的**间接访问权**（通过 Prowlarr）和 qBittorrent 的**完全控制权**。

- 一定设强 `APP_PASSWORD`；登录接口已限流（5 分钟 8 次）。
- 别把 `9696`（Prowlarr）暴露到公网——它的 API Key 等于所有站点的登录态。配完站可以把 compose 里那行端口映射注掉。
- 会话 cookie 是 `HttpOnly` + `SameSite=Lax` + `secure:auto`（HTTPS 下自动加 Secure）。
- `.env` 不要提交到仓库（`.gitignore` 已排除）。

> `test/` 目录里的 `smoketest123`、`mt-secret-token` 等是 mock 服务的测试夹具，不是真实凭据。

## 致谢与许可

- 站点协议细节参考了 [PT-depiler](https://github.com/pt-plugins/PT-depiler)（MIT）——
  尤其是 M-Team 的 API 交互方式。本仓库代码为独立实现。
- 本项目以 [MIT](LICENSE) 发布。
