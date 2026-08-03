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

### 1. 部署到 NAS

镜像由 GitHub Actions 构建好推到 Docker Hub（amd64 + arm64 双架构），
NAS 上只需拉取，不占 NAS 资源、也不用在 NAS 上装构建工具链。

```bash
# 在 NAS 上，任选一个目录
mkdir -p /volume1/docker/ptpocket && cd /volume1/docker/ptpocket   # 群晖示例

# 只需要这两个文件
curl -O https://raw.githubusercontent.com/dougefla/ptpocket/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/dougefla/ptpocket/main/.env.example

openssl rand -hex 32          # 输出填进 .env 的 SESSION_SECRET
vi .env                       # 见下方「必改项」

docker compose pull
docker compose up -d
```

**`.env` 里必改的几项：**

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` 生成 |
| `APP_PASSWORD` | 打开 App 时输入的密码 |
| `PROWLARR_API_KEY` | 第 2 步配好 Prowlarr 后回来填 |
| `QB_URL` / `QB_PASSWORD` | 指向你的 qBittorrent（远程也可以，见 1c） |
| `DATA_DIR` | 配置存放目录，写绝对路径 |
| `PUID` / `PGID` | 群晖常是 `1026`/`100`，OMV/威联通 `1000`/`100`，unRAID `99`/`100`，用 `id` 确认 |

`PTPOCKET_IMAGE` 默认已指向本项目发布的公开镜像，不用改；除非你 fork 后自建（见 1d）。

**没有 qBittorrent？** 加 profile 一起装：

```bash
docker compose --profile qbit up -d      # 同时把 QB_URL 改成 http://qbittorrent:8080
```

**下载器在远程、NAS 上不装 qBittorrent？** 那段本来就在 `profiles: [qbit]` 下，
不传 `--profile qbit` 就永远不会启动，**留着不影响任何东西**。
想让文件更干净可以整段删掉（`qbittorrent:` 那个服务块），已验证删后 compose 仍有效、
`depends_on` 指向的是 prowlarr 不受影响。顺带 `.env` 里的 `QB_PORT` 和
`DOWNLOADS_DIR` 也就没人读了，可一并删除。

**想自己改代码后本地构建**（不推荐在低配 NAS 上做，可能几十分钟或 OOM）：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 1a. OpenMediaVault（OMV）

OMV 用 omv-extras 的 **Compose 插件**管理 Docker，流程和命令行不太一样。

**准备**（只做一次）：

1. 装好 [omv-extras](https://wiki.omv-extras.org/)，再到 **System → Plugins** 安装
   `openmediavault-compose`（它会带上 Docker）
2. **Services → Compose → Settings**，指定几个共享文件夹：
   - **Compose Files** —— 存放各 stack 的 yml 和 env
   - **Appdata** —— 容器配置持久化位置
   - **Docker Storage** —— **务必放在数据盘而不是系统盘**，否则容易把 OS 盘写满
3. **Users** 里建一个专用用户（如 `appuser`，不要用 root），记下它的 UID；
   OMV 的 `users` 组 GID 是 **100**。把 Compose Files / Appdata 共享文件夹的
   权限给这个用户。

**部署**：

1. **Services → Compose → Files → ADD**
2. Name 填 `ptpocket`，把本仓库的 `docker-compose.yml` 内容粘进 YAML 框
3. 切到环境文件那一栏，把 `.env.example` 内容粘进去，按下面调整后保存
4. 先点 **Check** 校验语法，再点 **Up** 启动（首次会拉镜像）

**OMV 上的 `.env` 要点：**

```bash
PTPOCKET_IMAGE=douge/ptpocket:latest

# OMV 的 users 组是 100；PUID 填你建的那个用户的 UID（用 `id appuser` 查）
PUID=1000
PGID=100

# 相对路径最省事 —— Compose 插件会把 ./data 建在该 stack 自己的目录下，
# 不用去拼 /srv/dev-disk-by-uuid-xxxx/... 这种路径
DATA_DIR=./data
# 也可以用插件的占位符，它会替换成你在 Settings 里配的 data 共享文件夹：
# DATA_DIR=CHANGE_TO_COMPOSE_DATA_PATH/ptpocket
```

> **已适配的一个坑**：OMV 插件把环境文件命名为 `ptpocket.env` 而不是 `.env`。
> 本仓库的 compose 里两个名字都声明了且都标为可选，所以命令行和 OMV 都能直接用，
> 不需要改文件。

Up 之后按第 2 步配 Prowlarr（`http://<OMV_IP>:9696`），把 API Key 填回环境文件，
再点一次 **Up** 让它生效。

> 插件的备份功能可以用注释控制：给卷加 `# BACKUP` 强制备份、`# SKIP_BACKUP` 排除。
> 本项目的 `${DATA_DIR}/prowlarr` 值得备份（里面是站点定义和 Cookie）。

### 1c. 下载器在远程

完全支持，且**不需要给远程下载器任何 PT 站凭据**——后端会把 `.torrent` 字节直接
上传给它（`/api/v2/torrents/add` 的 multipart 文件字段），它不必能访问 PT 站，
也不需要 Cookie 或 passkey。只有三点要注意：

| 事项 | 说明 |
|---|---|
| **`QB_URL`** | 填远程地址，如 `https://qb.example.com`。别用 `host.docker.internal`，那是指宿主机。 |
| **必须用账号密码** | qB 的「对本机/白名单免认证」对远程访问不生效，`QB_USERNAME`/`QB_PASSWORD` 必填。 |
| **`QB_DEFAULT_SAVEPATH`** | 若要设置，写的是**远程机器上**的路径，不是 NAS 上的。 |

**传输安全**：qB WebUI 的登录是明文表单。如果直接暴露在公网上用 `http://`，
密码等于裸奔。按优先级选：

1. **VPN / Tailscale / WireGuard** 打通后用 `http://` 内网地址访问 —— 最省事也最安全
2. 套反代 + **正式证书**（Let's Encrypt），用 `https://`
3. 自签证书 —— 需要在 `.env` 里设 `QB_INSECURE_TLS=true`。这会关掉证书校验、
   失去中间人防护，仅在你确认链路可信时用。
   （这个开关只作用于 qBittorrent 连接，不影响 Prowlarr 和 PT 站的证书校验。）

连不上时不用猜，App 设置页会直接说明原因——域名解析失败、端口拒绝、连接超时、
自签证书、证书过期、证书与域名不符，都有对应的中文提示。

> 若远程 qB 挂在反代后面并用域名访问，记得在 qBittorrent 的
> **选项 → Web UI** 里把该域名加进「服务器域名白名单」，否则它会以
> Host 头校验失败为由拒绝请求。

### 1d. 自建镜像（可选，只需做一次）

Fork/clone 本仓库后，到 GitHub 仓库的
**Settings → Secrets and variables → Actions** 添加两个 secret：

| Secret | 值 |
|---|---|
| `DOCKERHUB_USERNAME` | 你的 Docker Hub 用户名 |
| `DOCKERHUB_TOKEN` | Docker Hub → Account Settings → Personal access tokens 生成，权限选 **Read & Write** |

之后每次推送到 `main` 都会自动跑冒烟测试 → 构建双架构镜像 → 推 Docker Hub。
打 `v1.0.0` 这样的 tag 会额外产出 `1.0.0` / `1.0` 版本标签。

> 构建用 GitHub 的**原生 arm64 runner**（公开仓库免费），不走 QEMU 模拟，
> 所以 Dockerfile 里没有 `--platform=$BUILDPLATFORM` —— 那会让不带 buildx
> 的旧版 Docker 无法本地构建。两个架构分别原生构建后合并 manifest。

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

## 需要暴露哪些端口

**对公网只需要一个：`8787`**（而且必须套 HTTPS）。其余全部留在内网。

| 端口 | 服务 | 对公网 | 说明 |
|---|---|---|---|
| **8787** | PT Pocket | **需要** | PWA 页面 + API，唯一入口。必须走 HTTPS，否则访问密码明文传输 |
| 9696 | Prowlarr | **绝对不要** | 它的 API Key 等于你**所有 PT 站的登录态**。只在初始配置时需要，之后可完全关闭 |
| 8191 | FlareSolverr | 不要 | compose 里刻意没发布。它是可被驱使访问任意网址的无头浏览器，暴露等于开放代理 |
| 8080 | qBittorrent | 不要 | 下载器在远程时本地没有这个端口；本地部署时也只需内网可达 |
| 6881 | qBittorrent | 视情况 | 仅本地跑 qB 时需要，是 BT 对等连接端口（开放能显著改善连接性），与本应用无关 |

**Prowlarr 的 9696 可以彻底关掉。** PT Pocket 是通过 Docker 内部网络用服务名
`prowlarr:9696` 访问它的，跟宿主机上发布的端口无关。已实测：把 9696 完全不发布
（宿主机也访问不到），搜索和推送依然正常。

配置完 Prowlarr 后，二选一收紧：

```bash
# 方案 1：注释掉 compose 里 prowlarr 的 ports 段（最安全）
# 方案 2：在 .env 里限定只允许 NAS 本机访问
PROWLARR_BIND=127.0.0.1
# 之后要改 Prowlarr 配置，用 SSH 端口转发：
#   ssh -L 9696:127.0.0.1:9696 你的NAS      然后浏览器开 http://localhost:9696
```

> **最推荐：Cloudflare Tunnel —— 一个入站端口都不用开。**
> compose 末尾有现成的注释配置，取消注释并填 `CF_TUNNEL_TOKEN` 即可；
> 同时把 ptpocket 的 `ports` 段也注释掉。这样 NAS 上零暴露、自带 HTTPS、
> 不用管 DDNS 和证书续期。

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
