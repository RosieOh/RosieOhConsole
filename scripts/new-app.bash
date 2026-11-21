#!/usr/bin/env bash
# 애플리케이션(카탈로그 구성요소) 추가 — api/src/catalog/defaults.ts 의 TREE 에 끼운다.
# 그룹·프로젝트가 있으면 그 밑에, 없으면 새로 만든다. --create-repo 면 GitHub 저장소도 만든다.
#
#   scripts/new-app.bash <key> --name 이름 --kind 종류 --group 그룹 [옵션]
#
#   <key>            구성요소 key, kebab-case (카탈로그 전체에서 하나)
#   --name           화면에 보일 이름 (필수)
#   --kind           backend | web | device-app | store-app | desktop-app | tool | notebook (필수)
#   --group          그룹 id: ai platform backend web apps lab data study … (필수)
#   --group-name     그룹이 없을 때 새로 만들 그룹 이름
#   --project        프로젝트 id (기본: key). 있으면 그 프로젝트에 구성요소를 더한다
#   --project-name   새 프로젝트 이름 (기본: --name)
#   --repo           GitHub 저장소 이름 (기본: key). 조직 저장소는 '<조직>/<저장소>'
#   --note           한 줄 설명
#   --prod           운영 주소(https) — 헬스·링크로 같이 쓴다
#   --create-repo    GitHub 에 저장소도 만든다(GITHUB_WRITE_TOKEN, .env 에서 읽음). --private 면 비공개
#   --yes            확인 묻지 않기
#   --check          만든 뒤 api 빌드·시험(catalog 시험 포함)
#
# 예) scripts/new-app.bash rosie-notes --name "Rosie Notes" --kind web --group web --note "메모 앱" --create-repo --private
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

KEY='' NAME='' KIND='' GROUP='' GROUP_NAME='' PROJECT='' PROJECT_NAME='' REPO='' NOTE='' PROD=''
CREATE=0 PRIVATE=0 CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --name) NAME="${2:?--name 값}"; shift 2 ;;
    --kind) KIND="${2:?--kind 값}"; shift 2 ;;
    --group) GROUP="${2:?--group 값}"; shift 2 ;;
    --group-name) GROUP_NAME="${2:?--group-name 값}"; shift 2 ;;
    --project) PROJECT="${2:?--project 값}"; shift 2 ;;
    --project-name) PROJECT_NAME="${2:?--project-name 값}"; shift 2 ;;
    --repo) REPO="${2:?--repo 값}"; shift 2 ;;
    --note) NOTE="${2:?--note 값}"; shift 2 ;;
    --prod) PROD="${2:?--prod 값}"; shift 2 ;;
    --create-repo) CREATE=1; shift ;;
    --private) PRIVATE=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --check) CHECK=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$KEY" ] || die "key 는 하나만: $1"; KEY="$1"; shift ;;
  esac
done
[ -n "$KEY" ] && [ -n "$NAME" ] && [ -n "$KIND" ] && [ -n "$GROUP" ] || usage 1
PROJECT="${PROJECT:-$KEY}"; REPO="${REPO:-$KEY}"
is_kebab "$KEY" || die "key 는 kebab-case 로: $KEY"
is_kebab "$PROJECT" || die "--project 는 kebab-case 로: $PROJECT"
is_kebab "$GROUP" || die "--group 은 kebab-case 로: $GROUP"
case "$KIND" in backend|web|device-app|store-app|desktop-app|tool|notebook) ;; *) die "--kind 는 backend | web | device-app | store-app | desktop-app | tool | notebook" ;; esac
printf '%s' "$REPO" | grep -Eq '^([A-Za-z0-9-]{1,39}/)?[A-Za-z0-9._-]{1,100}$' || die "저장소 이름이 올바르지 않습니다: $REPO"
[ -z "$PROD" ] || printf '%s' "$PROD" | grep -Eq '^https?://' || die "--prod 는 http(s):// 주소로"
need node

info "카탈로그에 '$NAME' ($KIND) 추가 → $GROUP › $PROJECT  [저장소 $REPO]"
args=(--file="$ROOT/api/src/catalog/defaults.ts" --group="$GROUP" --project="$PROJECT" --key="$KEY" --name="$NAME" --kind="$KIND" --repo="$REPO")
[ -n "$GROUP_NAME" ] && args+=(--group-name="$GROUP_NAME")
[ -n "$PROJECT_NAME" ] && args+=(--project-name="$PROJECT_NAME")
[ -n "$NOTE" ] && args+=(--note="$NOTE")
[ -n "$PROD" ] && args+=(--prod="$PROD")
patch catalog "${args[@]}"

if [ "$CREATE" = 1 ]; then
  need curl
  load_env
  TOKEN="${GITHUB_WRITE_TOKEN:-}"
  [ -n "$TOKEN" ] || die "GITHUB_WRITE_TOKEN 이 없습니다(.env) — 카탈로그만 고쳤습니다"
  case "$REPO" in
    */*) ORG="${REPO%%/*}"; RNAME="${REPO#*/}"; URL="https://api.github.com/orgs/$ORG/repos" ;;
    *) RNAME="$REPO"; URL="https://api.github.com/user/repos" ;;
  esac
  vis=공개; [ "$PRIVATE" = 1 ] && vis=비공개
  confirm "GitHub 에 $vis 저장소 '$REPO' 를 만들까요?" || { warn "저장소는 만들지 않았습니다 — 카탈로그만 고쳤습니다"; exit 0; }
  body="$(RNAME="$RNAME" NOTE="$NOTE" PRIVATE="$PRIVATE" node -e '
    process.stdout.write(JSON.stringify({ name: process.env.RNAME, description: process.env.NOTE || undefined,
      private: process.env.PRIVATE === "1", auto_init: true }))')"
  out="$(mktemp)"; trap 'rm -f "$out"' EXIT
  code="$(curl -sS -o "$out" -w '%{http_code}' -X POST "$URL" \
    -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
    --data "$body")"
  case "$code" in
    201) ok "저장소를 만들었습니다: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).html_url)' "$out")" ;;
    422) warn "저장소가 이미 있거나 이름이 맞지 않습니다(422): $(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(b.errors?.map(e=>e.message).join(", ")||b.message)' "$out")" ;;
    *) die "저장소를 만들지 못했습니다(HTTP $code): $(head -c 300 "$out")" ;;
  esac
fi

if [ "$CHECK" = 1 ]; then
  info "api 빌드·시험"
  (cd "$ROOT/api" && npm run build --silent && npm test --silent) || die "빌드나 시험이 실패했습니다 — 위 출력을 보세요"
  ok "api 빌드·시험 통과"
fi

dim "배포 트랙·테스트배드 헬스는 defaults.ts 에서 직접 적습니다. 이미 돌고 있는 콘솔은 설정 › 서비스 카탈로그에서 추가해도 됩니다."
