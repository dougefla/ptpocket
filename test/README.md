# 冒烟测试

```bash
./test/run.sh
```

不需要真实账号。`test/mocks/` 里的假服务会顶替 Prowlarr、qBittorrent 和 M-Team，
起服务 → 跑用例 → 收尾全自动，跑完 83 项断言。改了适配器、路由或 qB 客户端之后跑一遍。

| 文件 | 作用 |
|---|---|
| `run.sh` | 编排：清端口 → 起 mock → 起后端 → 跑两套用例 → 收尾 |
| `smoke-prowlarr.sh` | Prowlarr 路径 41 项：认证、Torznab 解析、SSE、推送、qB 版本兼容 |
| `smoke-mteam.sh` | M-Team 适配器 42 项：优惠枚举、两步下载、令牌失效、SSRF |
| `mocks/prowlarr-qb.mjs` | 假 Prowlarr（Torznab XML）+ 假 qBittorrent 5.x |
| `mocks/mteam.mjs` | 假 M-Team JSON API（校验 `x-api-key` 与 `Origin`） |

## 覆盖到的关键行为

这些都是踩过的坑，别删：

- **优惠解析** — Prowlarr 侧 30%/50%/免费/2x 来自 Torznab 的 `downloadvolumefactor`；
  M-Team 侧来自它自有的 `FREE`/`PERCENT_70`/`_2X_FREE` 枚举，且全站促销规则优先于单种。
- **qB 版本兼容** — 断言 5.x 用 `stopped` + `/torrents/stop`，且没误发 4.x 的 `paused` / `/pause`。
  另有一份 4.x mock 验反向路由（见 git 历史）。
- **掉登录态** — Prowlarr 返回 200 + HTML 登录页时，必须靠首字节 `0x64`（bencode `d`）拦掉，
  否则 qB 只回一句没头没尾的 `Fails.`。
- **SSRF** — 下载地址由前端回传，origin 会被**强制改写**成已配置的 Prowlarr。
  用例传入 `169.254.169.254` 后断言 mock 收到了被改写的请求，即攻击者主机从未被访问。
  注意这里不能改成「校验 origin 相等」——Prowlarr 在 Docker 里常自报错误地址，
  校验相等会把正常下载全挡掉（这个 bug 真的犯过）。
- **单站失败降级** — 一个站挂了不影响其余站，SSE 走 `error` 事件单独上报。

## 单跑某一套

```bash
# 先手动起 mock 和后端（参照 run.sh 里的环境变量），然后：
B=http://127.0.0.1:8793 ./test/smoke-mteam.sh
```

用例是幂等的（开跑前会重置 mock 计数），可以反复跑。
但注意登录接口限流为 5 分钟 8 次——对同一个后端进程连跑多次会触发 429，
`run.sh` 每轮都起新进程所以不受影响。
