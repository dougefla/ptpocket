#!/bin/bash
# 一键跑完整冒烟测试：起 mock -> 起后端 -> 跑两套用例 -> 收尾
#
# 不需要真实的 Prowlarr / qBittorrent / M-Team 账号，全部由 test/mocks 里的
# 假服务提供。改了适配器或路由之后跑一遍，能挡住绝大多数回归。
#
#   ./test/run.sh
set -u
S="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$S/.." && pwd)"

PORT_MAIN=8793      # 正常配置的后端
PORT_BADTOKEN=8794  # 故意配错 M-Team 令牌，用于验证报错

PORTS="9696 8080 9700 $PORT_MAIN $PORT_BADTOKEN"

cleanup() {
  for v in PID_MOCK1 PID_MOCK2 PID_SRV1 PID_SRV2; do
    pid="${!v:-}"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # 等端口真正释放，否则紧接着再跑一次会撞上 EADDRINUSE，
  # 新进程起不来、测试却打到上一轮的旧进程上（限流已耗尽 -> 一片 429）
  for _ in $(seq 1 25); do
    busy=0
    for p in $PORTS; do
      lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && busy=1
    done
    [ "$busy" = "0" ] && break
    sleep 0.2
  done
}
trap cleanup EXIT INT TERM

echo "==> 清理可能残留的进程"
for p in $PORTS; do
  pids=$(lsof -nP -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null)
  [ -n "$pids" ] && echo "  端口 $p 被占用，先结束 $pids" && kill $pids 2>/dev/null
done
for _ in $(seq 1 25); do
  busy=0
  for p in $PORTS; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && busy=1
  done
  [ "$busy" = "0" ] && break
  sleep 0.2
done
for p in $PORTS; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $p 仍被占用，无法继续（请手动检查）"; exit 1
  fi
done

echo "==> 校验 compose 环境变量覆盖完整"
node "$S/check-compose-env.mjs" || exit 1

echo "==> 构建后端"
(cd "$ROOT" && pnpm --filter @ptpocket/server build) >/dev/null || { echo "构建失败"; exit 1; }

echo "==> 启动 mock 服务（Prowlarr:9696 qBittorrent:8080 M-Team:9700）"
node "$S/mocks/prowlarr-qb.mjs" > "$S/prowlarr-qb.log" 2>&1 & PID_MOCK1=$!
node "$S/mocks/mteam.mjs"       > "$S/mteam.log"       2>&1 & PID_MOCK2=$!
sleep 1.5

export APP_PASSWORD=smoketest123
export SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef
export PROWLARR_URL=http://127.0.0.1:9696
export PROWLARR_API_KEY=test-prowlarr-key
export QB_URL=http://127.0.0.1:8080
export QB_USERNAME=admin
export QB_PASSWORD=adminpass
export MTEAM_URL=http://127.0.0.1:9700
export LOG_LEVEL=warn

echo "==> 启动后端"
# exec 让 node 顶替子 shell，这样 $! 拿到的就是 node 自己的 pid，
# 收尾时 kill 才真正杀掉监听进程（否则端口会残留到下一轮）
(cd "$ROOT" && MTEAM_API_KEY=mt-secret-token PORT=$PORT_MAIN     exec node server/dist/index.js > "$S/server.log"     2>&1) & PID_SRV1=$!
(cd "$ROOT" && MTEAM_API_KEY=wrong-token     PORT=$PORT_BADTOKEN exec node server/dist/index.js > "$S/server-bad.log" 2>&1) & PID_SRV2=$!

ready=0
for i in $(seq 1 30); do
  # 两个后端都要就绪，否则用例会打到不完整的环境上
  if curl -sf -m 2 "http://127.0.0.1:$PORT_MAIN/api/health" >/dev/null 2>&1 &&
     curl -sf -m 2 "http://127.0.0.1:$PORT_BADTOKEN/api/auth/me" >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.4
done
if [ "$ready" = "0" ]; then
  echo "后端未能就绪，日志："; tail -20 "$S/server.log" "$S/server-bad.log"; exit 1
fi
# 确认起来的确实是本轮进程，而不是残留的旧进程
if ! kill -0 "$PID_SRV1" 2>/dev/null; then
  echo "后端进程已退出（很可能端口冲突），日志："; tail -20 "$S/server.log"; exit 1
fi

fail=0
echo
echo "######################## Prowlarr 路径 ########################"
B="http://127.0.0.1:$PORT_MAIN" "$S/smoke-prowlarr.sh" || fail=1
echo
echo "######################## M-Team 适配器 ########################"
B="http://127.0.0.1:$PORT_MAIN" BAD_B="http://127.0.0.1:$PORT_BADTOKEN" "$S/smoke-mteam.sh" || fail=1

echo
if [ "$fail" = "0" ]; then
  echo "全部通过 ✓"
else
  echo "有用例失败，日志见 $S/*.log"
fi
exit $fail
