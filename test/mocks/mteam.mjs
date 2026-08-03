/**
 * 模拟 M-Team API（api.m-team.cc 的行为）。
 * 严格照 PT-depiler 里的协议：POST + x-api-key + Origin 校验 + message:"SUCCESS"
 */
import { createServer } from "node:http";

const log = (...a) => console.log("[mteam]", ...a);
const TOKEN = "mt-secret-token";
const TORRENT = Buffer.from(
  "d8:announce20:http://mteam/announce4:infod6:lengthi2048e4:name10:MTeam.File12:piece lengthi16384e6:pieces0:ee",
);

const seen = { originChecked: false, dlTokenCalls: 0, searchModes: [] };

const torrent = (o) => ({
  id: o.id,
  name: o.name,
  smallDescr: o.sub ?? null,
  createdDate: o.created ?? "2026-07-30 12:34:56",
  category: o.cat ?? "419",
  size: String(o.size ?? 8589934592),
  numfiles: "5",
  labelsNew: o.labels ?? [],
  status: {
    seeders: String(o.seeders ?? 10),
    leechers: String(o.leechers ?? 2),
    timesCompleted: "33",
    discount: o.discount ?? "NORMAL",
    discountEndTime: o.discountEnd ?? null,
    toppingLevel: o.topping ?? "0",
    promotionRule: o.promotionRule ?? null,
    mallSingleFree: o.mallFree ?? null,
  },
});

createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const readBody = () =>
    new Promise((r) => {
      const c = [];
      req.on("data", (x) => c.push(x));
      req.on("end", () => r(Buffer.concat(c)));
    });

  (async () => {
    // 下载令牌换来的地址：只有它不校验 Origin（模拟 CDN 直链）
    if (p === "/dl") {
      log("提供种子字节");
      return void res
        .writeHead(200, { "content-type": "application/x-bittorrent" })
        .end(TORRENT);
    }

    // 测试内省端点，走 GET，必须在方法校验之前
    if (p === "/__seen") return void res.writeHead(200).end(JSON.stringify(seen));
    if (p === "/__reset") {
      seen.dlTokenCalls = 0;
      seen.searchModes = [];
      seen.originChecked = false;
      log("状态已重置");
      return void res.writeHead(200).end("ok");
    }

    log(req.method, p, "x-api-key:", (req.headers["x-api-key"] ?? "(缺失)").slice(0, 8), "origin:", req.headers.origin ?? "(缺失)");

    if (req.method !== "POST") {
      log("  !! 非 POST 请求");
      return void res.writeHead(405).end("method not allowed");
    }
    if (req.headers["x-api-key"] !== TOKEN) {
      return void res.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({ code: "401", message: "UNAUTHORIZED", data: null }),
      );
    }
    // 站点 2025-10-28 起强制校验 Origin
    if (!req.headers.origin) {
      log("  !! 缺少 Origin");
      return void res.writeHead(403).end("missing origin");
    }
    seen.originChecked = true;

    if (p === "/api/member/profile") {
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ code: "0", message: "SUCCESS", data: { id: "1", username: "tester" } }));
    }

    if (p === "/api/torrent/search") {
      const body = JSON.parse((await readBody()).toString() || "{}");
      seen.searchModes.push(body.mode);
      log("  搜索:", JSON.stringify({ mode: body.mode, keyword: body.keyword, pageSize: body.pageSize }));

      if (body.mode === "adult") {
        return void res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            code: "0", message: "SUCCESS",
            data: { pageNumber: 1, total: "1", data: [torrent({ id: "9001", name: "Adult.Item", cat: "410" })] },
          }),
        );
      }

      const list = [
        // 单种免费 + 到期时间
        torrent({ id: "1001", name: "Some.Movie.2026.2160p.WEB-DL.DV.HDR-MTeam", sub: "某部电影 4K 杜比视界 官方中字",
          discount: "FREE", discountEnd: "2026-08-05 23:59:59", size: 64424509440, seeders: 88, leechers: 12,
          labels: ["中字", "杜比视界"], cat: "419" }),
        // 2X 免费
        torrent({ id: "1002", name: "Some.Show.S02.1080p.WEB-DL-MTeam", sub: "某剧集 第二季 全集",
          discount: "_2X_FREE", size: 32212254720, seeders: 40, leechers: 3, cat: "402" }),
        // 30% (PERCENT_70)
        torrent({ id: "1003", name: "Old.Movie.1999.1080p.BluRay.REMUX-MTeam", sub: "老片 蓝光原盘重灌",
          discount: "PERCENT_70", size: 21474836480, seeders: 6, leechers: 1, cat: "439" }),
        // 50% + 置顶
        torrent({ id: "1004", name: "Music.Album.FLAC.24bit-MTeam", sub: "无损音乐专辑",
          discount: "PERCENT_50", size: 1073741824, seeders: 15, leechers: 0, cat: "434", topping: "1" }),
        // 全站促销规则优先于单种 discount：单种写 NORMAL，但全站 FREE
        torrent({ id: "1005", name: "Global.Promo.Item-MTeam", sub: "全站促销中",
          discount: "NORMAL", promotionRule: { discount: "FREE" }, size: 5368709120, seeders: 3, leechers: 9, cat: "401" }),
        // 无优惠
        torrent({ id: "1006", name: "Normal.Price.Item-MTeam", sub: "正常计费",
          discount: "NORMAL", size: 2147483648, seeders: 1, leechers: 0, cat: "409" }),
      ];
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ code: "0", message: "SUCCESS", data: { pageNumber: 1, total: String(list.length), data: list } }));
    }

    if (p === "/api/torrent/genDlToken") {
      const raw = (await readBody()).toString("latin1");
      const ct = req.headers["content-type"] ?? "";
      seen.dlTokenCalls++;
      const isMultipart = ct.startsWith("multipart/form-data");
      const id = /name="id"\r\n\r\n(\d+)/.exec(raw)?.[1] ?? new URLSearchParams(raw).get("id");
      log("  genDlToken:", JSON.stringify({ multipart: isMultipart, id }));

      if (!id) return void res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ code: "1", message: "id required", data: null }));

      // 按请求的 Host 回显下载地址，这样容器内访问也能拿到可达的 URL
      const host = req.headers.host ?? "127.0.0.1:9700";
      return void res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ code: "0", message: "SUCCESS", data: `http://${host}/dl?id=${id}&token=tmp` }));
    }

    if (p === "/__seen") return void res.writeHead(200).end(JSON.stringify(seen));
    if (p === "/__reset") {
      seen.dlTokenCalls = 0;
      seen.searchModes = [];
      seen.originChecked = false;
      log("状态已重置");
      return void res.writeHead(200).end("ok");
    }

    res.writeHead(404).end("nf");
  })().catch((e) => {
    log("error", e);
    res.writeHead(500).end("err");
  });
}).listen(9700, "127.0.0.1", () => log("mock -> :9700 (api.* 与站点同端口)"));
