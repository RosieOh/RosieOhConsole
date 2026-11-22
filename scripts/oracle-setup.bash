#!/usr/bin/env bash
# 운영 서버 준비(Oracle Cloud 무료 ARM VM · Ubuntu 24.04 기준, 다른 Ubuntu VM 도 된다) — 이 컴퓨터에서 실행
#
#   scripts/oracle-setup.bash ubuntu@<서버IP> [옵션]
#
#   --domain <주소>   콘솔 주소. 없으면 <IP>.sslip.io (도메인을 산 뒤 --domain 으로 다시 실행하면 주소만 바꾼다)
#   --port <포트>     SSH 포트 (기본 22)
#   --no-github       GitHub 환경·시크릿·변수는 넣지 않는다(서버만 준비)
#   --no-start        서버 준비 뒤 콘솔을 띄우지 않는다
#   --yes             묻지 않는다(.env 가 없으면 OAuth 값은 그래도 묻는다)
#
# 하는 일
#   1) 서버: Docker·git 설치, 80·443 열기(Oracle 이미지의 iptables), deploy 사용자, /opt/rosie-console 에 저장소 clone,
#      매일 04:30 DB 백업(cron, /home/deploy/backups 14개)
#   2) 반영 키: 새 ed25519 키를 만들어 deploy 사용자에 command=rosie-deploy 로 묶어 등록(그 키로는 반영만 된다)
#   3) deploy/.env: 비밀값(SESSION_SECRET·DB 비밀번호·PROBE_TOKEN)을 만들고 OAuth·토큰은 물어서 서버에만 둔다
#   4) GitHub: 환경 production(main 만), 시크릿 DEPLOY_HOST·DEPLOY_SSH_KEY·DEPLOY_KNOWN_HOSTS, 변수 DEPLOY_URL·DEPLOY_ENABLED
#   5) 지금 main 커밋으로 처음 띄우기
#
# 미리: Oracle VCN 보안 목록에 TCP 80·443 수신 허용, 운영용 GitHub OAuth 앱(콜백 https://<주소>/dashapi/oauth/callback) — deploy/README.md
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
TARGET='' DOMAIN='' PORT=22 GITHUB=1 START=1
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --domain) DOMAIN="${2:?--domain 값}"; shift 2 ;;
    --port) PORT="${2:?--port 값}"; shift 2 ;;
    --no-github) GITHUB=0; shift ;;
    --no-start) START=0; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$TARGET" ] || die "서버는 하나만: $1"; TARGET="$1"; shift ;;
  esac
done
[ -n "$TARGET" ] || usage 1
case "$TARGET" in *@*) ;; *) die "user@host 로 주세요 (Oracle Ubuntu 이미지는 ubuntu@<IP>)" ;; esac
need ssh; need ssh-keygen; need openssl
[ "$GITHUB" = 0 ] || need gh "GitHub 시크릿을 넣으려면(없으면 --no-github)"

HOST="${TARGET#*@}"
REPO="${CONSOLE_REPO:-RosieOh/RosieOhConsole}"
GIT_URL="${CONSOLE_GIT_URL:-https://github.com/$REPO.git}"   # 서버가 clone 할 주소(포크 등)
APP=/opt/rosie-console
if [ -z "$DOMAIN" ]; then
  printf '%s' "$HOST" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' || die "IP 가 아니면 --domain 을 주세요"
  DOMAIN="$(printf '%s' "$HOST" | tr . -).sslip.io"
fi
printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || die "주소 형식이 아닙니다: $DOMAIN"
URL="https://$DOMAIN"
SSH=(ssh -p "$PORT" -o ConnectTimeout=20 "$TARGET")
SSHN=(ssh -n -p "$PORT" -o ConnectTimeout=20 "$TARGET")   # 입력을 넘기지 않는 호출 — 아니면 ssh 가 이 스크립트의 입력(아래에서 물을 값)을 먹는다

info "서버 $TARGET · 콘솔 주소 $URL"
"${SSHN[@]}" true || die "SSH 로 들어가지 못했습니다 — 키·보안 목록(22)·사용자 이름을 보세요"

# ── 1) 서버 기본 준비 ─────────────────────────────────────────────
info "1/5 서버 준비(Docker·git·방화벽·deploy 사용자·저장소)"
"${SSH[@]}" "sudo bash -s $GIT_URL $APP" <<'REMOTE'
set -euo pipefail
GIT_URL="$1" APP="$2"
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -yq docker.io docker-compose-v2 git >/dev/null
fi
command -v git >/dev/null || apt-get install -yq git >/dev/null
systemctl enable --now docker >/dev/null 2>&1 || true

# Oracle Ubuntu 이미지는 iptables 가 22 말고는 REJECT — 그 앞에 80·443 을 끼운다
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null && continue
  n="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
  if [ -n "$n" ]; then iptables -I INPUT "$n" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  else iptables -A INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT; fi
done
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true

id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
if [ ! -d "$APP/.git" ]; then git clone -q "$GIT_URL" "$APP"; fi
chown -R deploy:deploy "$APP"
sudo -u deploy git -C "$APP" fetch -q origin main
sudo -u deploy git -C "$APP" checkout -q --detach origin/main

install -d -o deploy -g deploy -m 700 /home/deploy/backups
cat > /etc/cron.d/rosie-console-backup <<CRON
30 4 * * * deploy cd $APP && BACKUP_DIR=/home/deploy/backups KEEP=14 scripts/db-backup.bash --prod >> /home/deploy/backups/backup.log 2>&1
CRON
echo "  docker $(docker --version | awk '{print $3}' | tr -d ,) · compose $(docker compose version --short)"
REMOTE
"${SSH[@]}" 'cat > /tmp/rosie-deploy' < "$ROOT/deploy/rosie-deploy"
"${SSHN[@]}" 'sudo install -m 755 /tmp/rosie-deploy /usr/local/bin/rosie-deploy && rm -f /tmp/rosie-deploy'
ok "서버 준비 끝"

# ── 2) 반영 키 ────────────────────────────────────────────────────
info "2/5 반영 키(command=rosie-deploy 로 묶음)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ssh-keygen -q -t ed25519 -N '' -C "rosie-console-deploy" -f "$TMP/key"
PUB="$(cat "$TMP/key.pub")"
printf '%s\n' "command=\"/usr/local/bin/rosie-deploy\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $PUB" \
  | "${SSH[@]}" 'sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh && sudo -u deploy sh -c "umask 077; grep -v rosie-console-deploy ~/.ssh/authorized_keys 2>/dev/null > ~/.ssh/ak.new; cat >> ~/.ssh/ak.new; mv ~/.ssh/ak.new ~/.ssh/authorized_keys"'
# known_hosts 는 이미 믿고 들어간 SSH 로 서버의 호스트 키를 직접 읽어 만든다(ssh-keyscan 보다 안전)
HK="$("${SSHN[@]}" 'cat /etc/ssh/ssh_host_ed25519_key.pub' | awk '{print $1" "$2}')"
[ -n "$HK" ] || die "서버 호스트 키를 읽지 못했습니다"
if [ "$PORT" = 22 ]; then KH="$HOST $HK"; else KH="[$HOST]:$PORT $HK"; fi
ok "반영 키 등록(이전 반영 키는 지움)"

# ── 3) deploy/.env ────────────────────────────────────────────────
info "3/5 deploy/.env"
if "${SSHN[@]}" "sudo test -f $APP/deploy/.env"; then
  # 이미 있으면 주소만 맞춘다
  "${SSHN[@]}" "sudo -u deploy sed -i -e 's|^CONSOLE_DOMAIN=.*|CONSOLE_DOMAIN=$DOMAIN|' -e 's|^PUBLIC_URL=.*|PUBLIC_URL=$URL|' $APP/deploy/.env"
  ok "있는 .env 를 둠(주소만 $DOMAIN 으로)"
else
  [ -t 0 ] || die ".env 를 만들려면 OAuth 값을 물어야 합니다 — 터미널에서 실행하세요"
  dim "  운영용 GitHub OAuth 앱 콜백: $URL/dashapi/oauth/callback"
  ask() { local v; printf '  %s: ' "$1" >&2; read -r v; printf '%s' "$v"; }
  ask_secret() { local v; printf '  %s (입력 숨김): ' "$1" >&2; read -rs v; echo >&2; printf '%s' "$v"; }
  OID="$(ask OAUTH_CLIENT_ID)"; [ -n "$OID" ] || die "OAUTH_CLIENT_ID 가 필요합니다"
  OSEC="$(ask_secret OAUTH_CLIENT_SECRET)"; [ -n "$OSEC" ] || die "OAUTH_CLIENT_SECRET 가 필요합니다"
  GT="$(ask_secret 'GITHUB_TOKEN (읽기, 엔터면 건너뜀)')"
  GWT="$(ask_secret 'GITHUB_WRITE_TOKEN (쓰기, 엔터면 건너뜀)')"
  umask 077
  cat > "$TMP/env" <<ENV
# 운영 콘솔 — scripts/oracle-setup.bash 가 만듦. 이 파일은 서버에만 둔다
CONSOLE_DOMAIN=$DOMAIN
PUBLIC_URL=$URL
OAUTH_CLIENT_ID=$OID
OAUTH_CLIENT_SECRET=$OSEC
SESSION_SECRET=$(openssl rand -hex 32)
GITHUB_OWNER=RosieOh
CONSOLE_ADMINS=RosieOh
GITHUB_ORGS=MarioChunjaeIT
GITHUB_TOKEN=$GT
GITHUB_WRITE_TOKEN=$GWT
PROBE_TOKEN=$(openssl rand -hex 24)
MARIADB_PASSWORD=$(openssl rand -hex 24)
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 24)
CONSOLE_IMAGE=ghcr.io/rosieoh/rosieohconsole:latest
ENV
  "${SSH[@]}" "sudo -u deploy sh -c 'umask 077; cat > $APP/deploy/.env'" < "$TMP/env"
  ok ".env 를 서버에 만듦(이 컴퓨터에는 남기지 않음)"
fi

# ── 4) GitHub ─────────────────────────────────────────────────────
if [ "$GITHUB" = 1 ]; then
  info "4/5 GitHub 환경 production · 시크릿 · 변수 ($REPO)"
  if confirm "$REPO 에 환경 production(main 만)과 DEPLOY_* 시크릿·변수를 넣을까요?"; then
    printf '%s' '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
      | gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null
    gh api "repos/$REPO/environments/production/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null | grep -qx main \
      || gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" -f name=main -f type=branch >/dev/null
    gh secret set DEPLOY_SSH_KEY --env production --repo "$REPO" < "$TMP/key"
    printf '%s' "$HOST" | gh secret set DEPLOY_HOST --env production --repo "$REPO"
    printf '%s' "$KH" | gh secret set DEPLOY_KNOWN_HOSTS --env production --repo "$REPO"
    gh variable set DEPLOY_URL --body "$URL" --repo "$REPO"
    [ "$PORT" = 22 ] || gh variable set DEPLOY_PORT --body "$PORT" --repo "$REPO"
    gh variable set DEPLOY_ENABLED --body true --repo "$REPO"
    ok "GitHub 설정 끝 — 이제 main 머지마다 자동 반영"
  else
    warn "GitHub 설정을 건너뜀 — 반영 워크플로는 DEPLOY_ENABLED 가 없어서 돌지 않습니다"
  fi
else
  dim "4/5 GitHub 건너뜀(--no-github)"
fi
rm -f "$TMP/key"

# ── 5) 처음 띄우기 ─────────────────────────────────────────────────
if [ "$START" = 1 ]; then
  info "5/5 지금 main 커밋으로 띄우기"
  "${SSHN[@]}" "sudo -u deploy bash -c 'cd $APP && scripts/server-deploy.bash \$(git rev-parse HEAD)'" \
    || die "띄우지 못했습니다 — 서버에서: cd $APP/deploy && docker compose -f compose.prod.yml logs"
  for i in $(seq 1 30); do
    if curl -fsS --max-time 10 "$URL/dashapi/health" >/dev/null 2>&1; then ok "열림 $URL"; break; fi
    [ "$i" = 30 ] && warn "$URL 가 아직 응답하지 않습니다 — VCN 보안 목록의 80·443, 인증서 발급(Caddy 로그)을 보세요"
    sleep 5
  done
else
  dim "5/5 띄우기 건너뜀(--no-start)"
fi

echo
ok "끝. GitHub OAuth 앱 콜백: $URL/dashapi/oauth/callback"
dim "  서버 들어가기: ssh -p $PORT $TARGET   ·  콘솔 폴더: $APP (deploy 사용자)"
