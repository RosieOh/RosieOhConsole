#!/usr/bin/env bash
# 로컬 개발 서버 — api(8087) + web(Vite) 를 같이 띄우고, Ctrl+C 로 둘 다 끈다
#
#   scripts/dev.bash           실제 api: .env 를 읽어 빌드 후 실행(DATA_DIR 기본 ./data)
#   scripts/dev.bash --mock    가짜 api(web/dev/mock-api.mjs): 토큰 없이 화면만
#   scripts/dev.bash --api     api 만 / --web  web 만
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
MODE=real RUN_API=1 RUN_WEB=1
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --mock) MODE=mock; shift ;;
    --api) RUN_WEB=0; shift ;;
    --web) RUN_API=0; shift ;;
    *) die "모르는 옵션: $1" ;;
  esac
done
need node; need npm

for d in api web; do
  [ -d "$ROOT/$d/node_modules" ] || { info "$d 의존성 설치"; (cd "$ROOT/$d" && npm ci --no-audit --no-fund); }
done

pids=()
cleanup() { trap - INT TERM EXIT; [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null; }
trap cleanup INT TERM EXIT

if [ "$RUN_API" = 1 ]; then
  if [ "$MODE" = mock ]; then
    info "가짜 api → http://localhost:${MOCK_PORT:-8087}"
    (cd "$ROOT/web" && exec node dev/mock-api.mjs) & pids+=($!)
  else
    [ -f "$ROOT/.env" ] || die ".env 가 없습니다 — scripts/setup-env.bash 로 만들거나 --mock 으로 띄우세요"
    load_env
    export DATA_DIR="${DATA_DIR_DEV:-$ROOT/data}"   # .env 의 /data 는 컨테이너용 — 로컬은 ./data
    [ "${PUBLIC_URL:-}" ] || export PUBLIC_URL=http://localhost:8087
    info "api 빌드"
    (cd "$ROOT/api" && npm run build --silent)
    info "api → http://localhost:${PORT:-8087}  (DATA_DIR=$DATA_DIR)"
    (cd "$ROOT/api" && exec node dist/main.js) & pids+=($!)
  fi
fi
if [ "$RUN_WEB" = 1 ]; then
  info "web → http://localhost:5173"
  (cd "$ROOT/web" && exec npm run dev --silent) & pids+=($!)
fi

# 하나라도 죽으면 같이 끈다
while :; do
  for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null || { warn "프로세스 $p 가 끝났습니다 — 모두 끕니다"; exit 1; }; done
  sleep 1
done
