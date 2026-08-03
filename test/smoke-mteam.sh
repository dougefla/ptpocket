#!/bin/bash
# M-Team 原生适配器专项测试：站点列表 / 搜索字段映射 / 优惠枚举 / 两步下载 / 鉴权失败
set -u
B=${B:-http://127.0.0.1:8793}
J=/tmp/ptp_mt.txt
S="$(cd "$(dirname "$0")" && pwd)"
rm -f $J
curl -s -m 5 "$(echo "${MTEAM_MOCK:-http://127.0.0.1:9700}")/__reset" >/dev/null 2>&1
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; echo "      got: $2"; fail=$((fail+1)); }
chk()  { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1" "$(echo "$2" | head -c 400)"; fi; }
nchk() { if echo "$2" | grep -q "$3"; then bad "$1" "$(echo "$2" | head -c 400)"; else ok "$1"; fi; }

curl -s -m 5 -c $J -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"password":"smoketest123"}' >/dev/null

echo "== 1. M-Team 出现在站点列表且标记为原生 =="
r=$(curl -s -m 10 -b $J $B/api/indexers)
chk "站点列表含 M-Team" "$r" 'M-Team'
chk "标记 native=true" "$r" '"id":"mteam","name":"M-Team","enabled":true,"privacy":"private","native":true'
chk "Prowlarr 站点用 p: 前缀" "$r" '"id":"p:1"'

echo "== 2. 健康检查含 M-Team 令牌自检 =="
r=$(curl -s -m 15 $B/api/health)
chk "native 自检通过" "$r" '"native":\[{"id":"mteam","name":"M-Team","ok":true}\]'

echo "== 3. 只搜 M-Team =="
r=$(curl -s -m 30 -b $J "$B/api/search?q=movie&indexerIds=mteam")
echo "$r" > /tmp/ptp_mt_search.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/ptp_mt_search.json'))
rs=d['releases']
by={r['siteId']:r for r in rs}
p=0;f=0
def chk(name,cond,extra=''):
    global p,f
    if cond: print("  ✓ "+name); p+=1
    else: print("  ✗ "+name+f"   got: {extra}"); f+=1

chk(f"只搜到 M-Team 一个源（{d['searched']}）", d['searched']==1, d['searched'])
chk(f"返回 6 条（{len(rs)}）", len(rs)==6, len(rs))
chk("全部 source=mteam", all(r['source']=='mteam' for r in rs))
chk("siteId 已带上", all(r['siteId'] for r in rs))
chk("infoUrl 指向 /detail/", all('/detail/' in (r['infoUrl'] or '') for r in rs))
chk("downloadUrl 为 null（下载地址需现取）", all(r['downloadUrl'] is None for r in rs))

# 优惠枚举映射
t=by.get('1001',{})
chk("FREE -> 免费, dl=0", t.get('discountLabel')=='FREE' and t.get('downloadFactor')==0, (t.get('discountLabel'),t.get('downloadFactor')))
chk("FREE 的到期时间已解析", bool(t.get('discountEndTime')), t.get('discountEndTime'))
chk("副标题(smallDescr)已取到", t.get('subtitle')=='某部电影 4K 杜比视界 官方中字', t.get('subtitle'))
chk("labelsNew 进 tags", '中字' in (t.get('tags') or []), t.get('tags'))
chk("size 解析为 60GiB", t.get('size')==64424509440, t.get('size'))
chk("seeders/leechers 解析", (t.get('seeders'),t.get('leechers'))==(88,12), (t.get('seeders'),t.get('leechers')))
chk("category 419 -> 电影(2000)", t.get('topCategory')==2000, t.get('topCategory'))

t=by.get('1002',{})
chk("_2X_FREE -> dl=0 且 up=2", (t.get('downloadFactor'),t.get('uploadFactor'))==(0,2), (t.get('downloadFactor'),t.get('uploadFactor')))
chk("category 402 -> 剧集(5000)", t.get('topCategory')==5000, t.get('topCategory'))

t=by.get('1003',{})
chk("PERCENT_70 -> 30%（只计30%）", t.get('discountLabel')=='30%' and t.get('downloadFactor')==0.3, (t.get('discountLabel'),t.get('downloadFactor')))

t=by.get('1004',{})
chk("PERCENT_50 -> 50%", t.get('discountLabel')=='50%' and t.get('downloadFactor')==0.5, (t.get('discountLabel'),t.get('downloadFactor')))
chk("toppingLevel -> 置顶 tag", '置顶' in (t.get('tags') or []), t.get('tags'))
chk("category 434 -> 音乐(3000)", t.get('topCategory')==3000, t.get('topCategory'))

t=by.get('1005',{})
chk("全站促销规则优先于单种 discount", t.get('discountLabel')=='FREE', (t.get('discountLabel'),t.get('downloadFactor')))

t=by.get('1006',{})
chk("NORMAL -> 无优惠标签", t.get('discountLabel') is None and t.get('downloadFactor')==1, (t.get('discountLabel'),t.get('downloadFactor')))

chk("M-Team 搜索接口不返回 HR，hasHr 全 false", all(r['hasHr'] is False for r in rs))
open('/tmp/ptp_mt_counts','w').write(f"{p} {f}")
PY
read -r sp sf < /tmp/ptp_mt_counts; pass=$((pass+sp)); fail=$((fail+sf))

echo "== 4. 只搜成人区（MTEAM_MODE 生效性）=="
nchk "默认 normal 模式下没有成人区结果" "$(cat /tmp/ptp_mt_search.json)" 'Adult.Item'
chk "mock 只收到 normal 模式请求" "$(curl -s http://127.0.0.1:9700/__seen)" '"searchModes":\["normal"\]'

echo "== 5. 两步下载并推送 qBittorrent =="
python3 -c "
import json
d=json.load(open('/tmp/ptp_mt_search.json'))
r=next(x for x in d['releases'] if x['siteId']=='1001')
open('/tmp/ptp_mt_push.json','w').write(json.dumps({
  'source':r['source'],'siteId':r['siteId'],'title':r['title'],'category':'movies','stopped':True}))
"
r=$(curl -s -m 20 -b $J -X POST $B/api/download -H 'content-type: application/json' -d @/tmp/ptp_mt_push.json)
chk "M-Team 种子推送成功" "$r" '"ok":true'
chk "调用了 genDlToken" "$(curl -s http://127.0.0.1:9700/__seen)" '"dlTokenCalls":1'
chk "genDlToken 用 multipart 提交" "$(grep genDlToken $S/mteam.log | tail -1)" '"multipart":true'
chk "请求带了 Origin（站点强制校验）" "$(curl -s http://127.0.0.1:9700/__seen)" '"originChecked":true'
chk "qB 收到的种子文件名为 mteam-1001" "$(grep 收到种子 $S/prowlarr-qb.log | tail -1)" 'mteam-1001.torrent'

echo "== 6. 缺 siteId 时报错 =="
r=$(curl -s -m 10 -b $J -X POST $B/api/download -H 'content-type: application/json' -d '{"source":"mteam","title":"x"}')
chk "缺 siteId 被拒" "$r" '缺少站点种子 id'
r=$(curl -s -m 10 -b $J -X POST $B/api/download -H 'content-type: application/json' -d '{"source":"mteam","siteId":"abc","title":"x"}')
chk "非法 siteId 被拒" "$r" '非法的 M-Team 种子 id'
r=$(curl -s -m 10 -b $J -X POST $B/api/download -H 'content-type: application/json' -d '{"source":"nope","siteId":"1","title":"x"}')
chk "未知来源被拒" "$r" '未知的来源'

echo "== 7. SSRF 防护：origin 被强制改写到 Prowlarr =="
# 传一个指向云元数据服务的地址。正确行为不是「报错拒绝」，而是 origin 被
# 覆盖成已配置的 Prowlarr，请求根本到不了 169.254.169.254。
r=$(curl -s -m 10 -b $J -X POST $B/api/download -H 'content-type: application/json' \
  -d '{"source":"p:1","downloadUrl":"http://169.254.169.254/latest/meta-data/","title":"x"}')
nchk "没有把元数据服务的响应当成种子接受" "$r" '"ok":true'
nchk "错误信息里不含攻击者主机（说明没去连它）" "$r" '169.254.169.254'
chk "请求落到了 Prowlarr（返回其 404 而非连接元数据）" "$r" 'error'
# 直接问 mock：它有没有收到过 /latest/meta-data/ 这种路径
chk "Prowlarr mock 收到了被改写后的请求" "$(grep -c 'latest/meta-data' $S/prowlarr-qb.log || true)" '[1-9]'

echo "== 8. 令牌失效时的报错可操作 =="
r=$(curl -s -m 15 http://127.0.0.1:8794/api/health)
chk "错误令牌导致 native ok=false" "$r" '"ok":false'
chk "给出可操作提示（实验室→存取令牌）" "$r" '存取令牌'

echo
echo "======================================"
echo "  通过 $pass 项，失败 $fail 项"
echo "======================================"
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
