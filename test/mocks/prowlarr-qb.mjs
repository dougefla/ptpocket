/** 模拟 Prowlarr (9696) 和 qBittorrent (8080)，用来给 ptpocket 后端做冒烟测试 */
import { createServer } from "node:http";

const log = (...a) => console.log("[mock]", ...a);

// ---------------------------------------------------------------- 假种子字节
// bencode: d8:announce...  必须以 'd' 开头，后端会校验
const TORRENT = Buffer.from(
  "d8:announce20:http://tracker/annc4:infod6:lengthi1024e4:name9:Test.File12:piece lengthi16384e6:pieces0:ee",
);

function torznab(items) {
  const body = items
    .map(
      (it) => `    <item>
      <title>${it.title}</title>
      <description>test</description>
      <guid>${it.guid}</guid>
      <prowlarrindexer id="${it.indexerId}" type="private">${it.indexer}</prowlarrindexer>
      <comments>https://example-pt.com/details.php?id=${it.guid}</comments>
      <pubDate>${new Date(it.published).toUTCString().replace("GMT", "+0000")}</pubDate>
      <size>${it.size}</size>
      <link>http://127.0.0.1:9696/${it.indexerId}/download?apikey=KEY&amp;link=abc&amp;file=${encodeURIComponent(it.title)}</link>
      <category>${it.cat}</category>
      <enclosure url="http://127.0.0.1:9696/${it.indexerId}/download?apikey=KEY" length="${it.size}" type="application/x-bittorrent" />
      <torznab:attr name="category" value="${it.cat}" />
      <torznab:attr name="seeders" value="${it.seeders}" />
      <torznab:attr name="peers" value="${it.peers}" />
      <torznab:attr name="grabs" value="7" />
      <torznab:attr name="files" value="3" />
      <torznab:attr name="infohash" value="${"a".repeat(40)}" />
      <torznab:attr name="downloadvolumefactor" value="${it.dlf}" />
      <torznab:attr name="uploadvolumefactor" value="${it.ulf}" />
${it.minSeedTime ? `      <torznab:attr name="minimumseedtime" value="${it.minSeedTime}" />\n` : ""}${it.minRatio ? `      <torznab:attr name="minimumratio" value="${it.minRatio}" />\n` : ""}${it.tag ? `      <torznab:attr name="tag" value="${it.tag}" />\n` : ""}    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="1.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <atom:link rel="self" type="application/rss+xml" />
    <title>Prowlarr</title>
${body}
  </channel>
</rss>`;
}

// ------------------------------------------------------------------ Prowlarr
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  log("prowlarr", req.method, url.pathname, url.searchParams.get("q") ?? "");

  if (req.headers["x-api-key"] !== "test-prowlarr-key" && !url.searchParams.get("apikey")) {
    res.writeHead(401).end("unauthorized");
    return;
  }

  if (url.pathname === "/api/v1/indexer") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify([
        { id: 1, name: "HDSky", enable: true, protocol: "torrent", privacy: "private" },
        { id: 2, name: "OurBits", enable: true, protocol: "torrent", privacy: "private" },
        { id: 3, name: "DisabledSite", enable: false, protocol: "torrent", privacy: "private" },
        { id: 4, name: "SomeUsenet", enable: true, protocol: "usenet", privacy: "private" },
      ]),
    );
    return;
  }

  // Torznab 搜索
  let m = /^\/api\/v1\/indexer\/(\d+)\/newznab$/.exec(url.pathname);
  if (m) {
    const id = Number(m[1]);
    if (id === 2) {
      // 模拟一个站点搜索失败，验证 SSE 的 error 事件与「部分失败」处理
      res.writeHead(500, { "content-type": "application/xml" }).end(
        '<?xml version="1.0"?><error code="900" description="站点登录态失效" />',
      );
      return;
    }
    const items = [
      { title: "Some.Movie.2024.2160p.WEB-DL.H265-GROUP", guid: "g1", indexerId: 1, indexer: "HDSky",
        published: Date.now() - 3 * 3600e3, size: 42_949_672_960, cat: 2040, seeders: 31, peers: 35, dlf: 0, ulf: 1 },
      { title: "另一部电影.1080p.BluRay.国粤双语.内封中字-测试组", guid: "g2", indexerId: 1, indexer: "HDSky",
        published: Date.now() - 30 * 3600e3, size: 8_589_934_592, cat: 2040, seeders: 5, peers: 9, dlf: 0.3, ulf: 2,
        minSeedTime: 259200, minRatio: 1 },
      { title: "Some.Show.S01.1080p.WEB-DL-GROUP", guid: "g3", indexerId: 1, indexer: "HDSky",
        published: Date.now() - 400 * 3600e3, size: 21_474_836_480, cat: 5040, seeders: 12, peers: 12, dlf: 1, ulf: 1,
        tag: "internal" },
      { title: "Full.Price.Music.FLAC", guid: "g4", indexerId: 1, indexer: "HDSky",
        published: Date.now() - 90 * 3600e3, size: 524_288_000, cat: 3040, seeders: 2, peers: 4, dlf: 0.5, ulf: 1 },
    ];
    res.writeHead(200, { "content-type": "application/xml" }).end(torznab(items));
    return;
  }

  // 种子下载代理
  m = /^\/(\d+)\/download$/.exec(url.pathname);
  if (m) {
    res
      .writeHead(200, {
        "content-type": "application/x-bittorrent",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("测试种子.torrent")}`,
      })
      .end(TORRENT);
    return;
  }

  res.writeHead(404).end("not found");
}).listen(9696, "127.0.0.1", () => log("prowlarr mock -> :9696"));

// --------------------------------------------------------------- qBittorrent
const added = [];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  const readBody = () =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  (async () => {
    log("qb", req.method, p);

    if (p === "/api/v2/auth/login") {
      const body = (await readBody()).toString();
      const params = new URLSearchParams(body);
      if (!req.headers.referer) {
        res.writeHead(403).end("no referer"); // 真实 qB 也是这个行为
        return;
      }
      if (params.get("username") !== "admin" || params.get("password") !== "adminpass") {
        res.writeHead(200).end("Fails.");
        return;
      }
      res.writeHead(200, { "set-cookie": "SID=mocksid123; path=/; HttpOnly" }).end("Ok.");
      return;
    }

    // 除登录外都要校验 SID
    if (!(req.headers.cookie ?? "").includes("SID=mocksid123")) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    if (p === "/api/v2/app/version") return void res.writeHead(200).end("v5.0.4");
    if (p === "/api/v2/app/webapiVersion") return void res.writeHead(200).end("2.11.2");
    if (p === "/api/v2/app/preferences")
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ save_path: "/downloads" }));
    if (p === "/api/v2/torrents/categories")
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ movies: { name: "movies", savePath: "/downloads/movies" }, tv: { name: "tv", savePath: "/downloads/tv" } }));
    if (p === "/api/v2/torrents/tags")
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(["pt", "ptpocket"]));
    if (p === "/api/v2/transfer/info")
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ dl_info_speed: 5_242_880, up_info_speed: 1_048_576 }));

    if (p === "/api/v2/torrents/info") {
      const list = [
        { hash: "1111111111111111111111111111111111111111", name: "Some.Movie.2024.2160p", size: 42_949_672_960, progress: 0.42, dlspeed: 5_242_880,
          upspeed: 0, state: "downloading", category: "movies", tags: "ptpocket", save_path: "/downloads/movies",
          added_on: 1_760_000_000, completion_on: 0, eta: 3600, num_seeds: 20, num_leechs: 3, ratio: 0.1,
          downloaded: 1e10, uploaded: 1e9, amount_left: 2e10 },
        ...added.map((a, i) => ({
          hash: `${i}`.padStart(40, "e"), name: a.filename, size: 1024, progress: 1, dlspeed: 0, upspeed: 2048,
          state: "stoppedUP", category: a.category ?? "", tags: a.tags ?? "", save_path: a.savepath || "/downloads",
          added_on: 1_760_000_100, completion_on: 1_760_000_200, eta: 8_640_000, num_seeds: 1, num_leechs: 0,
          ratio: 2, downloaded: 1024, uploaded: 2048, amount_left: 0,
        })),
      ];
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
    }

    if (p === "/api/v2/torrents/add") {
      const raw = await readBody();
      const ct = req.headers["content-type"] ?? "";
      if (!ct.startsWith("multipart/form-data")) {
        res.writeHead(415).end("expected multipart");
        return;
      }
      const s = raw.toString("latin1");
      // 校验种子字节确实到达，且是 bencode
      const hasTorrentPart = s.includes('name="torrents"');
      const hasBencode = s.includes("8:announce");
      const grab = (n) => {
        const re = new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`);
        return re.exec(s)?.[1];
      };
      const filenameMatch = /name="torrents"; filename="([^"]*)"/.exec(s);

      if (!hasTorrentPart || !hasBencode) {
        log("  !! add 缺少种子内容", { hasTorrentPart, hasBencode });
        res.writeHead(200).end("Fails.");
        return;
      }
      const utf8 = (v) => (v == null ? v : Buffer.from(v, "latin1").toString("utf8"));
      const rec = {
        filename: utf8(filenameMatch?.[1]) ?? "?",
        category: utf8(grab("category")),
        tags: utf8(grab("tags")),
        savepath: utf8(grab("savepath")),
        stopped: grab("stopped"),
        paused: grab("paused"),
        bytes: raw.length,
      };
      added.push(rec);
      log("  ✓ 收到种子", JSON.stringify(rec));
      res.writeHead(200).end("Ok.");
      return;
    }

    if (p === "/api/v2/torrents/stop" || p === "/api/v2/torrents/start" || p === "/api/v2/torrents/recheck" || p === "/api/v2/torrents/delete") {
      const body = (await readBody()).toString();
      log("  action", p, body);
      res.writeHead(200).end("");
      return;
    }
    // 旧端点应当不被调用（我们模拟的是 qB 5.x）
    if (p === "/api/v2/torrents/pause" || p === "/api/v2/torrents/resume") {
      log("  !! 调用了旧端点", p);
      res.writeHead(404).end("Not Found");
      return;
    }

    res.writeHead(404).end("not found");
  })().catch((e) => {
    log("qb error", e);
    res.writeHead(500).end("err");
  });
}).listen(8080, "127.0.0.1", () => log("qbittorrent mock -> :8080"));
