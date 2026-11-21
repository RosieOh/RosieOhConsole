#!/usr/bin/env bash
# MariaDB 백업 — 콘솔 DB 를 압축 덤프 하나로. 오래된 것은 지운다
#
#   scripts/db-backup.bash                      로컬 docker compose 의 mariadb(개발)
#   scripts/db-backup.bash --prod               deploy/compose.prod.yml 의 mariadb(운영 서버에서)
#   BACKUP_DIR=/var/backups/console KEEP=14 scripts/db-backup.bash --prod
#
# 되살리기: gunzip -c <파일> | docker compose exec -T mariadb mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" console
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
FILE_ARGS=()
case "${1:-}" in
  -h|--help) usage ;;
  --prod) FILE_ARGS=(-f "$ROOT/deploy/compose.prod.yml"); [ -f "$ROOT/deploy/.env" ] && load_env "$ROOT/deploy/.env" ;;
  '') load_env ;;
  *) die "모르는 옵션: $1" ;;
esac
need docker

DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${KEEP:-7}"
mkdir -p "$DIR"
OUT="$DIR/console-$(date +%Y%m%d-%H%M%S).sql.gz"
PW="${MARIADB_ROOT_PASSWORD:-console-root}"

info "덤프 → ${OUT#"$ROOT"/}"
docker compose ${FILE_ARGS[@]+"${FILE_ARGS[@]}"} exec -T -e MYSQL_PWD="$PW" mariadb \
  mariadb-dump -uroot --single-transaction --routines --databases console | gzip > "$OUT"
[ -s "$OUT" ] || { rm -f "$OUT"; die "덤프가 비었습니다 — mariadb 가 떠 있는지, 비밀번호가 맞는지 보세요"; }
ok "백업 $(du -h "$OUT" | cut -f1)"

# 최근 KEEP 개만 남긴다
ls -1t "$DIR"/console-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f"; dim "지움 ${f##*/}"; done
