# shellcheck shell=bash
# 스크립트 공용 함수 — 각 스크립트 맨 위에서 `source "$(dirname "$0")/function/common.bash"` 로 불러 쓴다.
# macOS 기본 bash(3.2)에서도 돌게 쓴다: ${v^}·연관 배열·mapfile 을 쓰지 않는다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="$ROOT/scripts"
TEMPLATES="$SCRIPTS/templates"
PATCH="$SCRIPTS/function/patch.mjs"

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_DIM=''; C_OFF=''
fi

info() { printf '%s▸%s %s\n' "$C_BLU" "$C_OFF" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YLW" "$C_OFF" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 이(가) 필요합니다${2:+ — $2}"; }

# y 를 눌러야 진행. ASSUME_YES=1 이면 묻지 않는다(--yes)
confirm() {
  [ "${ASSUME_YES:-0}" = 1 ] && return 0
  [ -t 0 ] || die "확인이 필요한데 터미널이 아닙니다 — --yes 로 다시 실행하세요"
  local a; printf '%s?%s %s [y/N] ' "$C_YLW" "$C_OFF" "$1"; read -r a
  [ "$a" = y ] || [ "$a" = Y ]
}

# 이름 규칙 — 소문자 kebab-case (build-cache)
is_kebab() { printf '%s' "$1" | grep -Eq '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'; }
# build-cache → BuildCache
to_pascal() { printf '%s' "$1" | awk -F- '{ for (i = 1; i <= NF; i++) printf "%s%s", toupper(substr($i,1,1)), substr($i,2) }'; }
# build-cache → buildCache
to_camel() { local p; p="$(to_pascal "$1")"; printf '%s%s' "$(printf '%s' "${p:0:1}" | tr '[:upper:]' '[:lower:]')" "${p:1}"; }

# 템플릿 채우기 — __KEY__ 를 환경변수 T_KEY 값으로 바꾼다(값에 / · 한글 · 따옴표가 있어도 안전)
#   T_NAME=foo T_PASCAL=Foo render templates/x.tpl out/x.ts
render() {
  local src="$1" dst="$2"
  [ -f "$src" ] || die "템플릿이 없습니다: $src"
  [ -e "$dst" ] && die "이미 있습니다: ${dst#"$ROOT"/}"
  mkdir -p "$(dirname "$dst")"
  perl -pe 's/__([A-Z_]+)__/exists $ENV{"T_$1"} ? $ENV{"T_$1"} : "__$1__"/ge' "$src" > "$dst"
  ok "만듦  ${dst#"$ROOT"/}"
}

# patch.mjs 실행 — 소스의 기준 줄을 찾아 끼운다
patch() { node "$PATCH" "$@"; }

# .env 를 읽어 환경변수로(이미 있는 값이 이긴다)
load_env() {
  local f="${1:-$ROOT/.env}" line k v
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    printf '%s' "$k" | grep -Eq '^[A-Z_][A-Z0-9_]*$' || continue
    [ -n "${!k:-}" ] || export "$k=$v"
  done < "$f"
}
