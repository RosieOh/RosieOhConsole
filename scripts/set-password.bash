#!/usr/bin/env bash
# 계정 비밀번호 정하기(터미널) — 화면에 들어올 방법이 없을 때. 처음 관리자는 계정이 없어도 만들어 준다
#
#   scripts/set-password.bash <아이디>     비밀번호를 두 번 묻는다(입력 숨김)
#
# .env 를 읽는다: DATABASE_URL 이 있으면 MariaDB, 없으면 DATA_DIR(로컬 기본 ./data) 파일. 콘솔이 떠 있으면 끄고 실행한다
# (콘솔은 시작할 때 계정을 메모리로 읽으므로, 떠 있는 동안 바꾸면 콘솔이 덮어쓸 수 있다)
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
case "${1:-}" in -h|--help) usage ;; '') usage 1 ;; esac
LOGIN="$1"
need node
[ -t 0 ] || die "비밀번호를 물어야 해서 터미널에서 실행하세요"

load_env
export DATA_DIR="${DATA_DIR_DEV:-$ROOT/data}"   # dev.bash 와 같은 자리(.env 의 /data 는 컨테이너용)
info "api 빌드"
(cd "$ROOT/api" && npm run build --silent)

printf '새 비밀번호 (%s): ' "$LOGIN"; read -rs PW1; echo
printf '한 번 더: '; read -rs PW2; echo
[ -n "$PW1" ] || die "비밀번호가 비었습니다"
[ "$PW1" = "$PW2" ] || die "두 번 넣은 비밀번호가 다릅니다"
printf '%s\n' "$PW1" | (cd "$ROOT/api" && node dist/tools/set-password.js "$LOGIN")
