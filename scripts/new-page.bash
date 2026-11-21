#!/usr/bin/env bash
# 웹 화면 만들기 — web/src/components/<Pascal>.tsx, api.ts 클라이언트 함수·타입, App.tsx 메뉴·라우팅, 가짜 API 응답
#
#   scripts/new-page.bash <이름> --title 제목 [--group 묶음] [--icon 아이콘] [--guard none|deployer|admin] [--store] [--check]
#
#   <이름>     kebab-case. 주소 #<이름>, API /dashapi/<이름> (scripts/new-api.bash 로 같은 이름을 만든다)
#   --title    메뉴·화면 제목 (필수)
#   --group    메뉴 묶음: home | deploy | infra | board | dev | settings (기본 dev)
#   --icon     lucide-react 아이콘 이름 (기본 Box) — https://lucide.dev/icons
#   --guard    admin 이면 관리자에게만 메뉴가 보인다. deployer 면 화면에 deployer 를 넘긴다
#   --store    추가·수정·삭제가 있는 화면(new-api.bash --store 와 짝)
#   --check    만든 뒤 web 타입 검사
#
# 예) scripts/new-page.bash build-cache --title "빌드 캐시" --group infra --icon Database --store
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

NAME='' TITLE='' GROUP=dev ICON=Box GUARD=none STORE=0 CHECK=0
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
[ -n "$NAME" ] || usage 1
[ -n "$TITLE" ] || die "--title 이 필요합니다"
is_kebab "$NAME" || die "이름은 kebab-case 로: $NAME (예: build-cache)"
case "$GUARD" in none|deployer|admin) ;; *) die "--guard 는 none|deployer|admin" ;; esac
need node
need perl

T_PASCAL="$(to_pascal "$NAME")"; T_CAMEL="$(to_camel "$NAME")"
export T_NAME="$NAME" T_PASCAL T_CAMEL T_TITLE="$TITLE" T_ICON="$ICON"
PAGE="$ROOT/web/src/components/$T_PASCAL.tsx"
[ -e "$PAGE" ] && die "이미 있습니다: web/src/components/$T_PASCAL.tsx"

# 아이콘이 lucide-react 에 있는지 — node_modules 가 있을 때만 본다
LUCIDE="$ROOT/web/node_modules/lucide-react/dist/lucide-react.d.ts"
if [ -f "$LUCIDE" ]; then
  grep -q "declare const $ICON:" "$LUCIDE" || die "lucide-react 에 '$ICON' 아이콘이 없습니다 — https://lucide.dev/icons 에서 PascalCase 이름으로"
else
  warn "web/node_modules 가 없어 아이콘 이름을 확인하지 못했습니다"
fi
[ -d "$ROOT/api/src/$NAME" ] || [ "${FROM_FEATURE:-0}" = 1 ] || warn "api/src/$NAME 이 없습니다 — scripts/new-api.bash $NAME 로 API 도 만드세요(가짜 API 로는 화면이 뜬다)"

info "화면 $T_PASCAL  →  #$NAME  (메뉴: $GROUP › $TITLE)"
store_flag=()
[ "$STORE" = 1 ] && store_flag=(--store)
suffix=''; [ "$STORE" = 1 ] && suffix='.store'
# App.tsx 가 가장 잘 실패한다(없는 묶음·이미 있는 화면) — 먼저 고쳐서, 실패하면 다른 파일은 건드리지 않게
patch web-app --file="$ROOT/web/src/App.tsx" --name="$NAME" --pascal="$T_PASCAL" --title="$TITLE" --group="$GROUP" --icon="$ICON" --guard="$GUARD" ${store_flag[@]+"${store_flag[@]}"}
patch web-api --file="$ROOT/web/src/api.ts" --name="$NAME" --pascal="$T_PASCAL" --camel="$T_CAMEL" --title="$TITLE" ${store_flag[@]+"${store_flag[@]}"}
patch mock --file="$ROOT/web/dev/mock-api.mjs" --name="$NAME" --title="$TITLE" ${store_flag[@]+"${store_flag[@]}"}
render "$TEMPLATES/web/page$suffix.tsx.tpl" "$PAGE"

if [ "$CHECK" = 1 ]; then
  info "web 타입 검사"
  (cd "$ROOT/web" && npm run typecheck --silent) || die "타입 검사가 실패했습니다 — 위 출력을 보세요"
  ok "web 타입 검사 통과"
fi

[ "${FROM_FEATURE:-0}" = 1 ] || dim "확인: scripts/dev.bash --mock  →  http://localhost:5173/#$NAME"
