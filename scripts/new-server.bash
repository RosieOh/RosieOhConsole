#!/usr/bin/env bash
# 점검할 서버 추가 — api/src/infra/defaults.ts 에 등록하고, 그 서버를 맡은 저장소에 넣을 probe.yml 을 만든다
#
#   scripts/new-server.bash <id> --name 이름 --repo 저장소 --ssh user@host [옵션]
#
#   <id>         서버 id, kebab-case (콘솔 서버 화면·점검 결과가 이 이름으로 묶인다)
#   --name       화면에 보일 이름 (필수)
#   --repo       probe.yml 을 둘 저장소(SSH 키 시크릿이 있는 곳). 조직 저장소는 '<조직>/<저장소>' (필수)
#   --ssh        SSH 접속 user@host (필수)
#   --port       SSH 포트 (기본 22)
#   --ip         IP — 연관 관계 수집이 이 호스트를 이 서버로 본다
#   --domains    도메인(쉼표로 여럿)
#   --note       한 줄 설명
#   --key        시크릿 이름 앞부분: <KEY>_SSH_KEY·<KEY>_SSH_KNOWN_HOSTS (기본 PROD)
#   --ref        재사용 워크플로를 고정할 커밋 SHA (기본: origin/main 의 지금 커밋)
#   --out        probe.yml 을 쓸 경로 (기본: 화면에 출력)
#   --check      등록 뒤 api 빌드·시험
#
# 예) scripts/new-server.bash home --name "집 서버" --repo RosieOhConsole --ssh rosie@192.0.2.24 --ip 192.0.2.24 --out /tmp/probe.yml
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
ID='' NAME='' REPO='' SSH='' PORT=22 IP='' DOMAINS='' NOTE='' KEY=PROD REF='' OUT='' CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --name) NAME="${2:?--name 값}"; shift 2 ;;
    --repo) REPO="${2:?--repo 값}"; shift 2 ;;
    --ssh) SSH="${2:?--ssh 값}"; shift 2 ;;
    --port) PORT="${2:?--port 값}"; shift 2 ;;
    --ip) IP="${2:?--ip 값}"; shift 2 ;;
    --domains) DOMAINS="${2:?--domains 값}"; shift 2 ;;
    --note) NOTE="${2:?--note 값}"; shift 2 ;;
    --key) KEY="${2:?--key 값}"; shift 2 ;;
    --ref) REF="${2:?--ref 값}"; shift 2 ;;
    --out) OUT="${2:?--out 값}"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$ID" ] || die "id 는 하나만: $1"; ID="$1"; shift ;;
  esac
done
[ -n "$ID" ] && [ -n "$NAME" ] && [ -n "$REPO" ] && [ -n "$SSH" ] || usage 1
is_kebab "$ID" || die "id 는 kebab-case 로: $ID"
printf '%s' "$REPO" | grep -Eq '^([A-Za-z0-9-]{1,39}/)?[A-Za-z0-9._-]{1,100}$' || die "저장소 이름이 올바르지 않습니다: $REPO"
printf '%s' "$SSH" | grep -Eq '^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$' || die "--ssh 는 user@host 모양으로: $SSH"
printf '%s' "$PORT" | grep -Eq '^[0-9]{1,5}$' || die "--port 는 숫자"
printf '%s' "$KEY" | grep -Eq '^[A-Z][A-Z0-9_]*$' || die "--key 는 대문자·숫자·_ (예: PROD)"
need node
# 재사용 워크플로 고정 — 브랜치(@main)가 아니라 커밋 SHA 로. 그 커밋이 GitHub 에 올라가 있어야 한다
if [ -z "$REF" ]; then
  REF="$(git -C "$ROOT" rev-parse --verify -q origin/main 2>/dev/null)" || die "origin/main 커밋을 찾지 못했습니다 — git fetch 하거나 --ref <SHA> 로"
fi
printf '%s' "$REF" | grep -Eq '^[0-9a-f]{40}$' || die "--ref 는 40자 커밋 SHA 로: $REF"

info "서버 '$NAME' ($ID) 등록 → api/src/infra/defaults.ts  [점검 저장소 $REPO]"
args=(--file="$ROOT/api/src/infra/defaults.ts" --id="$ID" --name="$NAME" --repo="$REPO")
[ -n "$IP" ] && args+=(--ip="$IP")
[ -n "$DOMAINS" ] && args+=(--domains="$DOMAINS")
[ -n "$NOTE" ] && args+=(--note="$NOTE")
patch infra "${args[@]}"

yml="$(sed -e "s/__SERVER__/$ID/" -e "s/__SSH_HOST__/$SSH/" -e "s/__SSH_PORT__/$PORT/" -e "s/__KEY__/$KEY/g" -e "s/__REF__/$REF/" "$ROOT/deploy/probe-caller.yml")"
if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")"; [ -e "$OUT" ] && die "이미 있습니다: $OUT"
  printf '%s\n' "$yml" > "$OUT"; ok "probe.yml → $OUT  ($REPO 의 .github/workflows/probe.yml 로)"
else
  echo; dim "── $REPO 의 .github/workflows/probe.yml ──"; printf '%s\n' "$yml"; echo
fi

if [ "$CHECK" = 1 ]; then
  info "api 빌드·시험"
  (cd "$ROOT/api" && npm run build --silent && npm test --silent) || die "빌드나 시험이 실패했습니다"
  ok "api 빌드·시험 통과"
fi
dim "다음: $REPO 에 시크릿 ${KEY}_SSH_KEY·${KEY}_SSH_KNOWN_HOSTS·PROBE_TOKEN, 변수 CONSOLE_URL 을 넣고 probe.yml 을 올린다. 콘솔 .env 의 PROBE_TOKEN 과 같은 값"
dim "호스트 키: ssh-keyscan -p $PORT ${SSH#*@} 결과를 ${KEY}_SSH_KNOWN_HOSTS 에(지문은 서버에서 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 로 맞춰 보기)"
dim "재사용 워크플로 고정: ${REF:0:12} — 콘솔의 server-probe.yml 을 바꾸면 probe.yml 의 SHA 를 올려야 반영된다"
