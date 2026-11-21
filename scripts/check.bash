#!/usr/bin/env bash
# 커밋 전 검사 — api 빌드·시험, web 타입 검사·시험(Dockerfile 과 같은 순서). 하나라도 실패하면 1
#
#   scripts/check.bash          둘 다
#   scripts/check.bash api      api 만 / web  web 만
#   scripts/check.bash --build  web 은 타입 검사 대신 실제 빌드(vite build)까지
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
DO_API=1 DO_WEB=1 BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    api) DO_WEB=0; shift ;;
    web) DO_API=0; shift ;;
    --build) BUILD=1; shift ;;
    *) die "모르는 인자: $1" ;;
  esac
done
need npm

failed=()
step() {   # step <이름> <디렉터리> <명령…>
  local name="$1" dir="$2"; shift 2
  info "$name"
  local t0=$SECONDS
  if (cd "$ROOT/$dir" && "$@"); then ok "$name ($((SECONDS - t0))초)"; else warn "$name 실패"; failed+=("$name"); fi
}

if [ "$DO_API" = 1 ]; then
  step 'api 빌드' api npm run build --silent
  step 'api 시험' api npm test --silent
fi
if [ "$DO_WEB" = 1 ]; then
  if [ "$BUILD" = 1 ]; then step 'web 빌드' web npm run build --silent; else step 'web 타입 검사' web npm run typecheck --silent; fi
  step 'web 시험' web npm test --silent
fi

[ ${#failed[@]} -eq 0 ] || die "실패: ${failed[*]}"
ok "모두 통과"
