#!/usr/bin/env bash
# 다른 컴퓨터로 옮기기 — DB·.env·data/ 를 파일 하나로 묶고, 새 컴퓨터에서 풀어 되살린다
#
#   scripts/migrate.bash export [파일]    지금 컴퓨터에서 묶기 (기본: backups/rosie-console-move-<시각>.tar.gz)
#   scripts/migrate.bash import <파일>    새 컴퓨터의 저장소 폴더에서 풀기 — .env·data/ 넣고, MariaDB 띄워 되살리고, npm ci
#     --force    import 때 이미 있는 .env(→ .env.bak-<시각>)·data/·DB 를 덮어쓴다
#
# 묶음에는 .env(비밀값)가 들어 있다 — AirDrop·USB 로 옮기고, 다 옮긴 뒤 지운다
# 새 컴퓨터: Docker Desktop·Node 22·git 설치 → git clone → cd → scripts/migrate.bash import <파일> → scripts/dev.bash
source "$(dirname "$0")/function/common.bash"

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
CMD="${1:-}"; [ $# -gt 0 ] && shift
FILE='' FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --force) FORCE=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *) [ -z "$FILE" ] || die "파일은 하나만: $1"; FILE="$1"; shift ;;
  esac
done
case "$CMD" in export|import) ;; -h|--help) usage ;; *) usage 1 ;; esac
need docker; need tar; need gzip
cd "$ROOT"

dc() { docker compose "$@"; }
db_pw() { printf '%s' "${MARIADB_ROOT_PASSWORD:-console-root}"; }
db_up() {
  docker info >/dev/null 2>&1 || die "Docker 가 꺼져 있습니다 — Docker Desktop 을 켜고 다시"
  [ -n "$(dc ps --status running -q mariadb 2>/dev/null)" ] && return 0   # 이미 떠 있으면 그대로(다시 만들지 않는다)
  info "MariaDB 띄우기"
  dc up -d --wait mariadb >/dev/null 2>&1 || die "MariaDB 를 띄우지 못했습니다 — docker compose logs mariadb"
}
db_tables() { dc exec -T -e MYSQL_PWD="$(db_pw)" mariadb mariadb -uroot -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='console'" 2>/dev/null | tr -d '[:space:]'; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [ "$CMD" = export ]; then
  load_env
  OUT="${FILE:-$ROOT/backups/rosie-console-move-$(date +%Y%m%d-%H%M%S).tar.gz}"
  mkdir -p "$(dirname "$OUT")"
  B="$TMP/rosie-console-move"; mkdir -p "$B"

  if [ -n "${DATABASE_URL:-}" ]; then
    db_up
    info "DB 덤프"
    dc exec -T -e MYSQL_PWD="$(db_pw)" mariadb \
      mariadb-dump -uroot --single-transaction --routines --databases console | gzip > "$B/console.sql.gz"
    [ "$(gzip -dc "$B/console.sql.gz" | head -c 1000 | wc -c | tr -d ' ')" -gt 0 ] || die "덤프가 비었습니다 — 비밀번호·MariaDB 상태를 보세요"
    ok "DB $(db_tables)개 표"
  else
    warn "DATABASE_URL 이 없습니다(파일 모드) — data/ 만 묶습니다"
  fi
  if [ -f .env ]; then cp .env "$B/env"; ok ".env"; else warn ".env 가 없습니다 — 새 컴퓨터에서 scripts/setup-env.bash 로 만듭니다"; fi
  if [ -d data ] && [ -n "$(ls -A data 2>/dev/null)" ]; then cp -R data "$B/data"; ok "data/ ($(du -sh data | cut -f1))"; fi
  {
    echo "만든 때: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "커밋: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
    echo "DB: $([ -f "$B/console.sql.gz" ] && echo 있음 || echo 없음)"
  } > "$B/MANIFEST"

  (umask 077; tar -czf "$OUT" -C "$TMP" rosie-console-move)
  chmod 600 "$OUT"
  ok "묶음 ${OUT#"$ROOT"/} ($(du -h "$OUT" | cut -f1))"
  dim "  .env(비밀값)가 들어 있습니다 — AirDrop·USB 로 옮기고 다 옮긴 뒤 지우세요"
  dim "  새 컴퓨터: git clone https://github.com/RosieOh/RosieOhConsole.git && cd RosieOhConsole && scripts/migrate.bash import <파일>"
  exit 0
fi

# ── import ──────────────────────────────────────────────────────────
[ -n "$FILE" ] || die "묶음 파일을 주세요: scripts/migrate.bash import <파일>"
[ -f "$FILE" ] || die "파일이 없습니다: $FILE"
tar -xzf "$FILE" -C "$TMP" || die "풀지 못했습니다 — scripts/migrate.bash export 로 만든 파일인지 보세요"
B="$TMP/rosie-console-move"
[ -f "$B/MANIFEST" ] || die "옮기기 묶음이 아닙니다(MANIFEST 없음)"
sed 's/^/  /' "$B/MANIFEST"

# .env
if [ -f "$B/env" ]; then
  if [ -f .env ] && ! cmp -s .env "$B/env"; then
    [ "$FORCE" = 1 ] || die ".env 가 이미 있고 내용이 다릅니다 — 덮어쓰려면 --force (지금 것은 .env.bak-<시각> 으로)"
    bak=".env.bak-$(date +%Y%m%d-%H%M%S)"; mv .env "$bak"; warn "기존 .env → $bak"
  fi
  (umask 077; cp "$B/env" .env); chmod 600 .env; ok ".env"
fi
load_env

# data/
if [ -d "$B/data" ]; then
  if [ -d data ] && [ -n "$(ls -A data 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
    warn "data/ 가 이미 있어 건드리지 않았습니다(덮어쓰려면 --force)"
  else
    mkdir -p data && cp -R "$B/data/." data/ && ok "data/"
  fi
fi

# DB
if [ -f "$B/console.sql.gz" ]; then
  db_up
  n="$(db_tables)"
  if [ "${n:-0}" -gt 0 ] && [ "$FORCE" != 1 ]; then
    die "DB 에 이미 표가 ${n}개 있습니다 — 묶음으로 덮어쓰려면 --force"
  fi
  info "DB 되살리기"
  gzip -dc "$B/console.sql.gz" | dc exec -T -e MYSQL_PWD="$(db_pw)" mariadb mariadb -uroot
  ok "DB $(db_tables)개 표"
fi

# 의존성
if command -v node >/dev/null 2>&1; then
  for d in api web; do
    if [ ! -d "$d/node_modules" ]; then info "npm ci ($d)"; (cd "$d" && npm ci --silent --no-audit --no-fund); fi
  done
else
  warn "node 가 없습니다 — Node 22 를 설치하고 npm --prefix api ci && npm --prefix web ci"
fi

echo
ok "옮기기 끝 — scripts/dev.bash 로 띄우면 http://localhost:5173"
dim "  묶음 파일($FILE)에는 비밀값이 있습니다 — 확인한 뒤 지우세요"
