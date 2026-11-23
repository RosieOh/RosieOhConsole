# Rosie 콘솔

[RosieOh](https://github.com/RosieOh) 의 GitHub 저장소를 한곳에서 보는 개인 콘솔. 저장소 카탈로그, 배포 현황·이력, 배포 흐름 도식, 구성도·연관 관계, 러너, 시크릿, 서버 점검, APK 보관함, 업무보드·주간보고를 GitHub API 로 다룬다. 콘솔 계정(아이디·비밀번호) 또는 GitHub 계정으로 로그인한다(가입은 관리자 승인 뒤).

## 메뉴
- **개요**: 카탈로그 트리(그룹 › 프로젝트 › 구성요소), 구성요소별 테스트배드·운영 헬스, 확인이 필요한 것
- **배포**: 현황 · 이력 · 되돌리기 · 운영 반영(예약)
  - Kamal 배포: GitHub Actions 실행 로그의 컨테이너 이름(`<서비스>-web-<환경>-<버전>`)에서 버전
  - GitHub Pages·Vercel: GitHub Deployments 환경(`github-pages`·`Production`)의 배포 기록에서 버전(커밋 12자)
- **배포 흐름**: 서비스 → GitHub(Actions) → 러너 → 산출물 → 대상 → 사람 → 데이터를 한 장에. 실행 중인 배포는 단계마다 움직인다
- **기능 스위치**: 서비스의 `/api/console/flags` 를 켜고 끈다(`api/src/flags/targets.ts`)
- **APK**: 기기앱 APK 를 GitHub 릴리스에서 중계(로그인 없이 `/apk`, IP 당 분당 30회)
- **서버**: 서버를 맡은 저장소의 `probe.yml`(재사용 워크플로 `server-probe.yml`)이 15분마다 보내는 부하·메모리·디스크·컨테이너, 로그 끝·다시 시작
- **러너**: 셀프 호스티드 러너(저장소별)와 워크플로의 `runs-on`. 호스티드 러너(`ubuntu-latest` 등)는 경고에서 뺀다
- **시크릿**: 저장소 시크릿·변수 이름과 쓰는 곳. 시크릿 값은 저장소 공개키로 봉인(libsodium sealed box)해서 쓴다
- **구성도**: 같은 전체 도식 · 연관 관계(설정 파일의 키 이름·호스트로 자동 수집 → 확정·거절) · DB 스키마
- **업무**: 보드(따라가는 저장소의 이슈 칸반 — `단계/<이름>` 라벨 또는 기록으로 단계) · 주간보고(자동 초안·저장·확정)
- **개발**: API 문서(테스트배드 OpenAPI) · Tools(테스트 JWT·API 테스터) · 도구(`api/src/tools/catalog.ts` 에 적은 저장소)
- **설정**(관리자): 서비스 카탈로그 · 회원(가입 승인·정지·임시 비밀번호) · 권한(역할) · 빌드 알림
- **마이페이지**(사용자 메뉴): 프로필, 비밀번호, GitHub 연결, 다른 기기 로그아웃, 로그인 기록, 탈퇴

## 현황

| 영역 | 상태 |
|---|---|
| 로그인·회원 | 콘솔 계정(scrypt) + GitHub OAuth. 가입·처음 보는 GitHub 로그인은 승인 대기 → 승인 시 보기 권한. 처음 관리자 `CONSOLE_ADMINS`, 비밀번호는 `scripts/set-password.bash` 로도 |
| 카탈로그 | RosieOh 저장소 84개 + 조직 MarioChunjaeIT 6개를 8개 그룹으로(`api/src/catalog/defaults.ts`). 종류: 백엔드·웹·기기앱·스토어 앱·데스크톱 앱·도구·노트북 |
| 배포 | 배포 기록이 있는 7개(대동여지도·BetweenTheLines·차곡·otel-canary·hoonShop·LeeEung — Pages, RosieTechBlog — Vercel)에 운영 헬스·배포 트랙. 서버 배포가 생기면 Kamal 트랙이나 환경 이름을 `LIVE` 에 |
| 조직 | `GITHUB_ORGS` 의 조직 저장소를 함께 다룬다. 콘솔 안의 저장소 이름은 `<조직>/<저장소>`(주인 저장소는 이름만) |
| 저장 | `DATABASE_URL` 이 있으면 MariaDB, 없으면 파일. 콘솔은 한 대만 띄운다고 본다 |
| 서버 점검 | 재사용 워크플로와 등록 스크립트(`scripts/new-server.bash`)는 있고, 등록된 서버는 아직 없다 |
| 업무보드 | GitHub Issues·PR 기반. 쓰기(단계 옮기기·막힘·닫기)는 `GITHUB_WRITE_TOKEN` 이 있어야 — 없으면 읽기 전용 |
| 운영 | Oracle Cloud 무료 ARM VM + compose(콘솔·MariaDB·Caddy). main 머지 → 이미지 → SSH 자동 반영(헬스 실패 시 이전 이미지로). 준비는 `scripts/oracle-setup.bash`, 순서는 [deploy/README.md](deploy/README.md) |

## 기술
- **web**: React 19 · Vite 8 · TypeScript 7 · three.js(로그인 화면만, 동적 로딩). 업무보드 화면도 여기(`web/src/board/`) — 한 SPA, 한 빌드
- **api**: NestJS 12 (ESM) · Express 5 · Node 22 — `/dashapi/*` + `/board/api/*` + 화면 정적 서빙(단일 컨테이너)
- 저장(`api/src/core/persist.ts`): `DATABASE_URL` 이 있으면 **MariaDB**, 없으면 `DATA_DIR`(기본 `/data`)의 JSON 파일(로컬 개발·시험)
  - `store(name, rev, value)` — 문서 하나가 한 줄: `catalog` · `access` · `accounts` · `board` · `schedules` · `relations` · `deploy-readings` …(파일 모드의 `<name>.json` 과 같은 이름)
  - `audit` — 감사 로그, `blob_file` — 로고 그림
  - 표는 시작할 때 스스로 만든다. 문서는 시작할 때 메모리로 읽고, 쓰기는 메모리 → DB 차례로. DB 에 없고 `DATA_DIR` 에 옛 파일이 있으면 처음 한 번 옮겨 온다
- GitHub 호출은 `api/src/core/github.ts`(`ghFetch`·`ghJson`·`ghRaw`·`ghPaged`·`ghGraphql`·`ownerRepos`) 한 곳으로
- 공통(`api/src/core/`): 설정(`config`), GitHub(`github`), 저장(`persist`·`json-store`), 감사 로그(`audit`), 출처 검사(`http` 의 `assertSameOrigin`), 요청 제한(`rate-limit` 의 `SlidingWindow`), 보안 헤더, 안전한 키·로그(`safe`). 기능 모듈은 여기서 가져다 쓰고, 같은 도우미를 모듈마다 새로 만들지 않는다

## 환경변수
`.env.example` 참고. 꼭 필요한 것은 `OAUTH_CLIENT_ID`·`OAUTH_CLIENT_SECRET`(GitHub OAuth 앱, 콜백 `<PUBLIC_URL>/dashapi/oauth/callback`) · `SESSION_SECRET`(32자 이상). `GITHUB_TOKEN` 이 없으면 공개 API 한도(시간당 60회)로 돌고 업무보드(GraphQL)는 읽지 못한다. 쓰기(되돌리기·운영 반영·시크릿·업무보드 옮기기·서버 점검 요청)는 `GITHUB_WRITE_TOKEN`.

## 로컬 개발
```
scripts/setup-env.bash          # .env 만들기(SESSION_SECRET 생성)
scripts/set-password.bash rosieoh   # 처음 관리자 비밀번호(GitHub 로그인 전에도 들어오게)
scripts/dev.bash                # api(8087) + web(5173) — 화면은 http://localhost:5173
scripts/dev.bash --mock         # 토큰 없이 가짜 API 로 화면만
scripts/check.bash              # 커밋 전 검사(api 빌드·시험, web 타입 검사·시험)
```
`dev.bash` 는 화면을 같이 띄우면 `PUBLIC_URL` 을 `http://localhost:5173` 으로 쓴다 — GitHub OAuth 앱 콜백에 `http://localhost:5173/dashapi/oauth/callback` 을 넣는다.

MariaDB 로 띄우려면(이 컴퓨터에 MariaDB 가 3306 을 쓰고 있어도 겹치지 않게 3307):
```
docker compose up -d mariadb
DATABASE_URL=mariadb://console:console@127.0.0.1:3307/console   # .env 에
TEST_DATABASE_URL=mariadb://console:console@127.0.0.1:3307/console npm --prefix api test   # MariaDB 시험까지
```

MariaDB 는 한 번 띄우면 Docker Desktop 이 켜질 때마다 다시 뜬다(`restart: unless-stopped`). 맥을 켤 때 Docker Desktop 도 뜨게 하려면 Docker Desktop 설정 › General › **Start Docker Desktop when you sign in**.

다른 컴퓨터로 옮기기:
```
scripts/migrate.bash export                 # 지금 컴퓨터 — backups/rosie-console-move-<시각>.tar.gz (DB·.env·data/, 비밀값 포함)
# 새 컴퓨터: Docker Desktop·Node 22·git 설치 후
git clone https://github.com/RosieOh/RosieOhConsole.git && cd RosieOhConsole
scripts/migrate.bash import <파일>          # .env·data/ 넣고 MariaDB 되살리기, npm ci
scripts/dev.bash
```

만들기 스크립트(`scripts/README.md`): `new-feature`·`new-api`·`new-page`(기능 한 벌), `new-app`(카탈로그 항목), `new-server`(점검할 서버), `db-backup`.

## 배포
- PR·main 마다 CI(`.github/workflows/ci.yml`) — api 빌드·시험(MariaDB 포함), web 타입 검사·시험·빌드
- main 머지마다 이미지(`.github/workflows/image.yml`) → `ghcr.io/rosieoh/rosieohconsole:<커밋 12자>`, `:latest` (amd64·arm64)
- 이미지가 성공하면 반영(`.github/workflows/deploy.yml`) — 운영 서버에 SSH 로 `deploy <커밋>` 만 보낸다. 서버의 `rosie-deploy` 가 main 에 있는 커밋인지 보고 `scripts/server-deploy.bash` 로 이미지를 바꾼다. 수동·되돌리기는 Actions 에서 커밋을 넣어 실행
- 운영: Oracle Cloud 무료 ARM VM 한 대에 `deploy/compose.prod.yml`(GHCR 이미지 + MariaDB + Caddy 자동 HTTPS). 서버 준비·첫 실행은 `scripts/oracle-setup.bash ubuntu@<IP> [--domain 주소]`, 도메인 전에는 `<IP>.sslip.io`
- 백업: 서버 cron 이 매일 `scripts/db-backup.bash --prod`
- 자세한 순서(VM 만들기·OAuth 앱·도메인 바꾸기): [deploy/README.md](deploy/README.md)
