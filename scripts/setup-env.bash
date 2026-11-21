#!/usr/bin/env bash
# .env 만들기 — .env.example 을 복사하고 SESSION_SECRET 을 채운다. 나머지 빈 값은 물어서 채운다
#
#   scripts/setup-env.bash          대화형(빈 값만 묻는다, 엔터로 건너뜀)
#   scripts/setup-env.bash --yes    묻지 않고 SESSION_SECRET·로컬 DATA_DIR 만 채운다
#   scripts/setup-env.bash --force  이미 있는 .env 를 .env.bak-<시각> 으로 옮기고 새로
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --yes) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    *) die "모르는 옵션: $1" ;;
  esac
done
need openssl

ENV="$ROOT/.env"
if [ -f "$ENV" ]; then
  [ "$FORCE" = 1 ] || die ".env 가 이미 있습니다 — 새로 만들려면 --force (지금 것은 백업)"
  bak="$ENV.bak-$(date +%Y%m%d-%H%M%S)"; mv "$ENV" "$bak"; warn "기존 .env → ${bak#"$ROOT"/}"
fi

# 값 바꾸기 — 키=값 줄을 통째로(값에 / & 가 있어도 안전하게 perl 환경변수로)
set_kv() { K="$1" V="$2" perl -pi -e 's/^\Q$ENV{K}\E=.*$/$ENV{K}=$ENV{V}/' "$ENV"; }

cp "$ROOT/.env.example" "$ENV"
chmod 600 "$ENV"
set_kv SESSION_SECRET "$(openssl rand -hex 32)"
set_kv DATA_DIR ./data
ok ".env 를 만들었습니다 (SESSION_SECRET 생성, DATA_DIR=./data)"

if [ "${ASSUME_YES:-0}" != 1 ] && [ -t 0 ]; then
  info "빈 값을 채웁니다 — 엔터면 건너뜀 (콜백: <PUBLIC_URL>/dashapi/oauth/callback)"
  keys="$(grep -E '^[A-Z_]+=$' "$ENV" | cut -d= -f1)"
  for k in $keys; do
    case "$k" in *SECRET*|*TOKEN*) printf '  %s (입력 숨김): ' "$k"; read -rs v; echo ;; *) printf '  %s: ' "$k"; read -r v ;; esac
    if [ -n "$v" ]; then set_kv "$k" "$v"; fi
  done
fi

missing="$(grep -E '^(OAUTH_CLIENT_ID|OAUTH_CLIENT_SECRET)=$' "$ENV" | cut -d= -f1 | tr '\n' ' ')"
[ -z "$missing" ] || warn "아직 비어 있음: ${missing}— 실제 api 는 이 값 없이 뜨지 않습니다(scripts/dev.bash --mock 은 됨)"
