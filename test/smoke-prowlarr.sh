#!/bin/bash
# ptpocket 冒烟测试：走完 登录 -> 搜索(含 SSE) -> 推送 -> 任务管理 全流程
set -u
B=${B:-http://127.0.0.1:8787}
J=/tmp/ptp_cookies.txt
rm -f $J
S="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0

ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; echo "      got: $2"; fail=$((fail+1)); }
chk()  { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1" "$(echo "$2" | head -c 300)"; fi; }
nchk() { if echo "$2" | grep -q "$3"; then bad "$1" "$(echo "$2" | head -c 300)"; else ok "$1"; fi; }

echo "== 1. 认证 =="
r=$(curl -s -m 5 $B/api/auth/me); chk "未登录时 authenticated=false" "$r" '"authenticated":false'
r=$(curl -s -m 5 -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"password":"wrong"}')
chk "错误密码被拒" "$r" '密码错误'
r=$(curl -s -m 5 -c $J -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"password":"smoketest123"}')
chk "正确密码登录成功" "$r" '"ok":true'
chk "下发了会话 cookie" "$(cat $J)" 'ptp_session'
r=$(curl -s -m 5 -b $J $B/api/auth/me); chk "带 cookie 时已认证" "$r" '"authenticated":true'
r=$(curl -s -m 5 $B/api/indexers); chk "无 cookie 访问受保护接口被拒" "$r" '未登录'

echo "== 2. 站点列表 =="
r=$(curl -s -m 5 -b $J $B/api/indexers)
chk "返回 torrent 站点" "$r" 'HDSky'
nchk "过滤掉了 usenet 站点" "$r" 'SomeUsenet'
chk "保留但标记了禁用站点" "$r" '"enabled":false'
chk "Prowlarr 站点 id 带 p: 前缀" "$r" '"id":"p:1"'

echo "== 3. 搜索（非流式）=="
r=$(curl -s -m 30 -b $J "$B/api/search?q=movie&indexerIds=p:1,p:2")
echo "$r" > /tmp/ptp_search.json
chk "返回结果" "$r" '"releases"'
chk "免费种识别为 FREE" "$r" '"discountLabel":"FREE"'
chk "30% 优惠正确解析" "$r" '"discountLabel":"30%"'
chk "50% 优惠正确解析" "$r" '"discountLabel":"50%"'
chk "2x 上传倍率解析" "$r" '"uploadFactor":2'
chk "HR 标记解析" "$r" '"hasHr":true'
chk "HR 做种时长解析" "$r" '"minimumSeedTime":259200'
chk "tag 透传 (internal)" "$r" 'internal'
chk "失败站点被记录到 errors" "$r" '站点登录态失效'
python3 - <<'PY'
import json
d=json.load(open('/tmp/ptp_search.json'))
rs=d['releases']
def chk(name, cond, extra=''):
    print(("  ✓ " if cond else "  ✗ ")+name+("" if cond else f"   got: {extra}"))
chk(f"结果条数为 4（拿到 {len(rs)}）", len(rs)==4, len(rs))
chk("leechers 由 peers-seeders 算出", any(r['leechers']==4 for r in rs), [ (r['seeders'],r['leechers']) for r in rs])
chk("按做种数降序", [r['seeders'] for r in rs]==sorted((r['seeders'] for r in rs), reverse=True), [r['seeders'] for r in rs])
chk("topCategory 归一到 2000/5000/3000", sorted({r['topCategory'] for r in rs})==[2000,3000,5000], sorted({r['topCategory'] for r in rs}))
chk("size 解析正确 (40GiB)", any(r['size']==42949672960 for r in rs))
chk("downloadUrl 存在且非 magnet", all(r['downloadUrl'] and not r['magnetUrl'] for r in rs))
chk("infoUrl 指向站点详情页", all('details.php' in (r['infoUrl'] or '') for r in rs))
chk("中文标题未损坏", any('另一部电影' in r['title'] for r in rs), [r['title'][:20] for r in rs])
PY

echo "== 4. 搜索（SSE 流式）=="
sse=$(curl -s -N -m 30 -b $J "$B/api/search/stream?q=movie&indexerIds=p:1,p:2" 2>/dev/null)
chk "SSE start 事件" "$sse" 'event: start'
chk "SSE results 事件" "$sse" 'event: results'
chk "SSE 单站失败走 error 事件" "$sse" 'event: error'
chk "SSE progress 事件" "$sse" 'event: progress'
chk "SSE done 事件" "$sse" 'event: done'
chk "SSE 里带上了优惠信息" "$sse" 'FREE'
n=$(echo "$sse" | grep -c 'event: progress')
if [ "$n" = "2" ]; then ok "progress 事件数 = 站点数 (2)"; else bad "progress 事件数应为 2" "$n"; fi

echo "== 5. 推送到 qBittorrent =="
python3 - <<'PY2'
import json
d = json.load(open('/tmp/ptp_search.json'))
url = next(r['downloadUrl'] for r in d['releases'] if r['discountLabel'] == 'FREE')
r = next(x for x in d['releases'] if x['discountLabel'] == 'FREE')
payload = {'source': r['source'], 'downloadUrl': url, 'title': 'Some.Movie.2024',
           'category': 'movies', 'tags': 'ptpocket,test', 'stopped': True}
open('/tmp/ptp_push.json', 'w').write(json.dumps(payload))
PY2
r=$(curl -s -m 20 -b $J -X POST $B/api/download -H 'content-type: application/json' -d @/tmp/ptp_push.json)
chk "推送成功" "$r" '"ok":true'
r=$(curl -s -m 20 -b $J -X POST $B/api/download -H 'content-type: application/json' -d '{"source":"p:1","title":"x"}')
chk "缺少链接时报错" "$r" '缺少 downloadUrl'

echo "== 6. 任务列表与操作 =="
r=$(curl -s -m 10 -b $J $B/api/qb/summary)
chk "qb summary 版本" "$r" 'v5.0.4'
chk "qb 分类列表" "$r" 'movies'
chk "qb 默认标签透传" "$r" 'ptpocket'
r=$(curl -s -m 10 -b $J $B/api/qb/torrents)
chk "任务列表包含刚推送的种子" "$r" '测试种子.torrent'
chk "种子文件名按 RFC5987 正确解码" "$(grep 收到种子 $S/prowlarr-qb.log | tail -1)" '测试种子.torrent'
chk "qB 5.x 用 stopped 参数" "$(grep 收到种子 $S/prowlarr-qb.log | tail -1)" '"stopped":"true"'
nchk "未误用 4.x 的 paused 参数" "$(grep 收到种子 $S/prowlarr-qb.log | tail -1)" '"paused":'
nchk "未调用已废弃的旧端点" "$(cat $S/prowlarr-qb.log)" '调用了旧端点'
r=$(curl -s -m 10 -b $J -X POST $B/api/qb/action -H 'content-type: application/json' -d '{"action":"stop","hashes":["1111111111111111111111111111111111111111"]}')
chk "暂停操作成功" "$r" '"ok":true'
r=$(curl -s -m 10 -b $J -X POST $B/api/qb/action -H 'content-type: application/json' -d '{"action":"delete","hashes":["1111111111111111111111111111111111111111"],"deleteFiles":true}')
chk "删除操作成功" "$r" '"ok":true'
r=$(curl -s -m 10 -b $J -X POST $B/api/qb/action -H 'content-type: application/json' -d '{"action":"bogus","hashes":["1111111111111111111111111111111111111111"]}')
chk "非法 action 被拒" "$r" 'error'

echo "== 7. 登出 =="
r=$(curl -s -m 5 -b $J -c $J -X POST $B/api/auth/logout); chk "登出成功" "$r" '"ok":true'
r=$(curl -s -m 5 -b $J $B/api/indexers); chk "登出后无法访问" "$r" '未登录'

echo
echo "======================================"
echo "  通过 $pass 项，失败 $fail 项"
echo "======================================"
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
