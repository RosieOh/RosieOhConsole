#!/usr/bin/env bash
# 기능 한 벌 만들기 — API 모듈(new-api.bash) + 웹 화면(new-page.bash)을 같은 이름으로 한 번에
#
#   scripts/new-feature.bash <이름> --title 제목 [--group 묶음] [--icon 아이콘] [--guard none|deployer|admin] [--store] [--check]
#
#   옵션은 두 스크립트와 같다. --check 면 api 빌드·시험과 web 타입 검사·시험까지 돌린다.
#
# 예) scripts/new-feature.bash build-cache --title "빌드 캐시" --group infra --icon Database --guard deployer --store --check
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

NAME='' TITLE='' GROUP='' ICON='' GUARD=none STORE=0 CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --title) TITLE="${2:?--title 값}"; shift 2 ;;
    --group) GROUP="${2:?--group 값}"; shift 2 ;;
    --icon) ICON="${2:?--icon 값}"; shift 2 ;;
    --guard) GUARD="${2:?--guard 값}"; shift 2 ;;
    --store) STORE=1; shift ;;
    --check) CHECK=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$NAME" ] || die "이름은 하나만: $1"; NAME="$1"; shift ;;
  esac
done
[ -n "$NAME" ] && [ -n "$TITLE" ] || usage 1
is_kebab "$NAME" || die "이름은 kebab-case 로: $NAME (예: build-cache)"

# 둘 중 하나라도 이미 있으면 아무것도 만들지 않는다
[ -e "$ROOT/api/src/$NAME" ] && die "이미 있습니다: api/src/$NAME"
[ -e "$ROOT/web/src/components/$(to_pascal "$NAME").tsx" ] && die "이미 있습니다: web/src/components/$(to_pascal "$NAME").tsx"

common=(--title "$TITLE" --guard "$GUARD")
[ "$STORE" = 1 ] && common+=(--store)
page=("${common[@]}")
[ -n "$GROUP" ] && page+=(--group "$GROUP")
[ -n "$ICON" ] && page+=(--icon "$ICON")

# 화면 쪽 검사(아이콘·묶음)가 더 까다로우니 먼저 — 실패하면 API 는 만들지 않는다
FROM_FEATURE=1 "$SCRIPTS/new-page.bash" "$NAME" "${page[@]}"
FROM_FEATURE=1 "$SCRIPTS/new-api.bash" "$NAME" "${common[@]}"

if [ "$CHECK" = 1 ]; then
  "$SCRIPTS/check.bash" || die "검사가 실패했습니다 — 위 출력을 보세요"
fi

ok "기능 '$NAME' 완성 — 확인: scripts/dev.bash --mock → http://localhost:5173/#$NAME"
dim "되돌리기: git checkout -- api/src/app.module.ts web/src/App.tsx web/src/api.ts web/dev/mock-api.mjs && rm -r api/src/$NAME api/test/$NAME.test.mjs web/src/components/$(to_pascal "$NAME").tsx"
