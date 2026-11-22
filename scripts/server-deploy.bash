#!/usr/bin/env bash
# 운영 서버에서 — 커밋의 콘솔 이미지로 바꾼다. 헬스가 오르지 않으면 이전 이미지로 되돌리고 실패로 끝낸다
#
#   scripts/server-deploy.bash <커밋>     보통은 rosie-deploy(Actions 의 deploy 워크플로)가 부른다. 서버에서 손으로도 된다
#
# deploy/.env 의 CONSOLE_IMAGE 를 ghcr.io/rosieoh/rosieohconsole:<커밋 12자> 로 고쳐 두므로,
# 서버에서 docker compose up 을 다시 해도 반영한 버전이 그대로 뜬다
set -euo pipefail

SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{12,40}$ ]] || { echo "사용법: $0 <커밋 12~40자>" >&2; exit 1; }
cd "$(dirname "$0")/../deploy"
[ -f .env ] || { echo "deploy/.env 가 없습니다 — scripts/oracle-setup.bash 로 만듭니다" >&2; exit 1; }

NEW="${CONSOLE_IMAGE_REPO:-ghcr.io/rosieoh/rosieohconsole}:${SHA:0:12}"
PREV="$(sed -n 's/^CONSOLE_IMAGE=//p' .env | tail -n 1)"

dc() { docker compose -f compose.prod.yml "$@"; }
set_image() {
  if grep -q '^CONSOLE_IMAGE=' .env; then sed -i "s|^CONSOLE_IMAGE=.*|CONSOLE_IMAGE=$1|" .env
  else printf 'CONSOLE_IMAGE=%s\n' "$1" >> .env; fi
}
# 콘솔 컨테이너의 healthcheck 가 healthy 가 될 때까지(최대 3분)
healthy() {
  local id st i
  for i in $(seq 1 60); do
    id="$(dc ps -q console 2>/dev/null || true)"
    st="$( [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo none)"
    case "$st" in healthy) return 0 ;; unhealthy) return 1 ;; esac
    sleep 3
  done
  return 1
}

echo "▸ 이미지 받기 $NEW"
docker image inspect "$NEW" >/dev/null 2>&1 || docker pull -q "$NEW" >/dev/null   # 못 받으면 .env 를 건드리기 전에 멈춘다
set_image "$NEW"
dc up -d --remove-orphans --quiet-pull
dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true   # Caddyfile 이 바뀌었을 때

if healthy; then
  echo "✓ 반영 $NEW"
  docker image prune -af --filter until=168h >/dev/null 2>&1 || true   # 쓰지 않는 일주일 넘은 이미지
  exit 0
fi

echo "✗ 헬스가 오르지 않았습니다 — 콘솔 로그 끝:" >&2
dc logs --tail 60 console >&2 || true
if [ -n "$PREV" ] && [ "$PREV" != "$NEW" ]; then
  set_image "$PREV"
  dc up -d
  if healthy; then echo "↩ 이전 이미지로 되돌렸습니다 $PREV" >&2; else echo "✗ 이전 이미지도 헬스가 오르지 않습니다 $PREV" >&2; fi
fi
exit 1
