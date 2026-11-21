#!/usr/bin/env bash
# API 모듈 만들기 — api/src/<이름>/ 에 controller·service·model, api/test/<이름>.test.mjs, app.module.ts 등록
#
#   scripts/new-api.bash <이름> [--title 제목] [--guard none|deployer|admin] [--store] [--check]
#
#   <이름>     kebab-case. 주소는 /dashapi/<이름>, 클래스는 PascalCase (build-cache → BuildCacheController)
#   --title    주석·시험 이름에 쓸 한글 제목 (기본: 이름)
#   --guard    로그인 외에 더 거를 권한. deployer = 관리자·배포 담당, admin = 관리자 (기본 none)
#   --store    DATA_DIR/<이름>.json 에 저장하는 CRUD(GET·POST·DELETE, rev 로 동시 편집 막기). 없으면 읽기 전용 + 30초 캐시
#   --check    만든 뒤 api 빌드·시험까지
#
# 예) scripts/new-api.bash build-cache --title "빌드 캐시" --guard deployer --store --check
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

NAME='' TITLE='' GUARD=none STORE=0 CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --title) TITLE="${2:?--title 값}"; shift 2 ;;
    --guard) GUARD="${2:?--guard 값}"; shift 2 ;;
    --store) STORE=1; shift ;;
    --check) CHECK=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$NAME" ] || die "이름은 하나만: $1"; NAME="$1"; shift ;;
  esac
done
[ -n "$NAME" ] || usage 1
is_kebab "$NAME" || die "이름은 kebab-case 로: $NAME (예: build-cache)"
case "$GUARD" in none|deployer|admin) ;; *) die "--guard 는 none|deployer|admin" ;; esac
need node
need perl

DIR="$ROOT/api/src/$NAME"
[ -e "$DIR" ] && die "이미 있습니다: api/src/$NAME"
grep -rqs "@Controller('dashapi/$NAME')" "$ROOT/api/src" && die "/dashapi/$NAME 를 이미 쓰는 컨트롤러가 있습니다"

T_PASCAL="$(to_pascal "$NAME")"
export T_NAME="$NAME" T_PASCAL
export T_TITLE="${TITLE:-$NAME}"

# 권한 데코레이터 — 클래스에 달면 모든 경로에 걸린다. 저장형은 쓰기 경로에 DeployerOnly 가 따로 붙는다
imports='AuthGuard'
case "$GUARD" in
  admin) imports="$imports, AdminOnly"; export T_GUARD_DECORATOR=$'@AdminOnly()\n' ;;
  deployer) imports="$imports, DeployerOnly"; export T_GUARD_DECORATOR=$'@DeployerOnly()\n' ;;
  *) export T_GUARD_DECORATOR='' ;;
esac
[ "$STORE" = 1 ] && [ "$GUARD" != deployer ] && imports="$imports, DeployerOnly"
export T_GUARD_IMPORTS="$imports"

kind='읽기 전용'; [ "$STORE" = 1 ] && kind='저장형'
info "API 모듈 $T_PASCAL  →  /dashapi/$NAME  (권한: $GUARD, $kind)"
suffix=''; [ "$STORE" = 1 ] && suffix='.store'
render "$TEMPLATES/api/model.ts.tpl"                "$DIR/model.ts"
render "$TEMPLATES/api/service$suffix.ts.tpl"       "$DIR/$NAME.service.ts"
render "$TEMPLATES/api/controller$suffix.ts.tpl"    "$DIR/$NAME.controller.ts"
render "$TEMPLATES/api/test.mjs.tpl"                "$ROOT/api/test/$NAME.test.mjs"
patch app-module --file="$ROOT/api/src/app.module.ts" --name="$NAME" --pascal="$T_PASCAL"

if [ "$CHECK" = 1 ]; then
  info "api 빌드·시험"
  (cd "$ROOT/api" && npm run build --silent && npm test --silent) || die "빌드나 시험이 실패했습니다 — 위 출력을 보세요"
  ok "api 빌드·시험 통과"
fi

[ "${FROM_FEATURE:-0}" = 1 ] || dim "다음: api/src/$NAME/$NAME.service.ts 를 채우고, 화면이 필요하면 scripts/new-page.bash $NAME"
