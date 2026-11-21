# Rosie 콘솔

[RosieOh](https://github.com/RosieOh) 의 GitHub 저장소를 한곳에서 보는 개인 콘솔. 저장소 카탈로그, 배포 현황·이력, 배포 흐름 도식, 구성도·연관 관계, 러너, 시크릿, APK 보관함 등을 GitHub API 로 읽는다. GitHub 계정으로 로그인한다(허용 명단에 있는 계정만).

> 지금은 사내 Gitea 기반 콘솔에서 GitHub 기반으로 옮기는 중이다. 아래 "옮기는 중" 표를 보고 작업한다.

## 메뉴
- **개요**: 카탈로그 트리(그룹 › 프로젝트 › 구성요소), 구성요소별 테스트배드·운영 헬스
- **배포**: 현황(AG Grid) · 이력 · 되돌리기 · 운영 반영(예약). 실행 기록은 GitHub Actions, 버전은 로그의 Kamal 컨테이너 이름(`<서비스>-web-<환경>-<버전>`)에서
- **배포 흐름**: 서비스 → GitHub(Actions) → 러너 → 산출물 → 대상 → 사람 → 데이터를 한 장에. 실행 중인 배포는 단계마다 움직인다
- **기능 스위치**: 서비스의 `/api/console/flags` 를 켜고 끈다(`api/src/flags/targets.ts`)
- **APK**: 기기앱 APK 를 GitHub 릴리스에서 중계(로그인 없이 `/apk`, IP 당 분당 30회)
- **서버**: 각 저장소의 `probe.yml` 이 보낸 점검 결과(`/dashapi/probe/ingest`, `PROBE_TOKEN`)
- **러너**: 셀프 호스티드 러너(저장소별)와 워크플로의 `runs-on`. 호스티드 러너(`ubuntu-latest` 등)는 경고에서 뺀다
- **시크릿**: 저장소 시크릿·변수 이름과 쓰는 곳. 변수는 만들기·바꾸기·지우기, 시크릿 값 쓰기는 아직 안 됨(아래)
- **구성도**: 같은 전체 도식 · 연관 관계(설정 파일의 키 이름·호스트로 자동 수집 → 확정·거절) · DB 스키마
- **업무**: 보드·주간보고 화면만 남아 있다(서버는 다시 만들 예정)
- **개발**: API 문서(테스트배드 OpenAPI) · Tools(테스트 JWT·API 테스터) · 도구(`api/src/tools/catalog.ts` 에 적은 저장소)
- **설정**(관리자): 서비스 카탈로그 · 권한(로그인할 GitHub 계정과 역할) · 빌드 알림

## 옮기는 중

| 영역 | 상태 |
|---|---|
| 로그인 | GitHub OAuth. `CONSOLE_ADMINS` + 권한 화면에 추가한 계정만 |
| 카탈로그 | 기본값 비어 있음. 화면에서 그룹·프로젝트를 만들고 저장소를 고른다. 헬스·배포 연결은 `api/src/catalog/defaults.ts` 에 코드로 |
| 배포·흐름·운영 반영 | GitHub Actions API 로 옮김. 카탈로그에 배포 트랙을 적어야 나온다 |
| 러너 | 저장소별 셀프 호스티드 러너 + 최근 push 한 저장소 10개의 최근 실행 5개씩의 작업 |
| 시크릿 | 목록·사용처·변수 쓰기는 됨. **시크릿 값 쓰기는 저장소 공개키 봉인(libsodium sealed box)이 필요해 꺼 둠** |
| APK | GitHub 릴리스(프리릴리스 = 내부 테스트). 다운로드는 릴리스 asset API 로 |
| 서버 | 점검 대상 서버 없음(`api/src/infra/defaults.ts`). probe 워크플로는 새로 만들어야 한다 |
| 업무보드 | 서버(board-core) 제거. `/board/api/*` 는 503. GitHub Issues·Projects 로 다시 만들 자리 |
| 인프라·배치 | `DEFAULT_INFRA` 는 GitHub·GHCR·Releases·Pages 만. `PLACEMENT`(구성요소 → 러너·산출물·대상) 비어 있음 |

## 기술
- **web**: React 19 · Vite 8 · TypeScript 7. 업무보드 화면도 여기(`web/src/board/`) — 한 SPA, 한 빌드
- **api**: NestJS 12 (ESM) · Express 5 · Node 22 — `/dashapi/*` + 화면 정적 서빙(단일 컨테이너)
- 데이터는 DB 없이 `DATA_DIR`(기본 `/data`)의 JSON 파일: `catalog.json` · `access.json` · `audit.jsonl` · `schedules.json` · `relations.json` …
- GitHub 호출은 `api/src/github.ts`(`ghFetch`·`ghJson`·`ghRaw`·`ghPaged`·`ownerRepos`) 한 곳으로

## 환경변수
`.env.example` 참고. 꼭 필요한 것은 `OAUTH_CLIENT_ID`·`OAUTH_CLIENT_SECRET`(GitHub OAuth 앱, 콜백 `<PUBLIC_URL>/dashapi/oauth/callback`) · `SESSION_SECRET`(32자 이상). `GITHUB_TOKEN` 이 없으면 공개 API 한도(시간당 60회)로 돈다.

## 로컬 개발
```
cd api && npm ci && npm run build && npm test
OAUTH_CLIENT_ID=… OAUTH_CLIENT_SECRET=… SESSION_SECRET=$(openssl rand -hex 32) \
  GITHUB_TOKEN=… DATA_DIR=./data PUBLIC_URL=http://localhost:8087 node dist/main.js
cd web && npm ci && npm run dev        # Vite (/dashapi·/mxtest·/board/api → 8087)
```

토큰 없이 화면만 보려면 가짜 API 를 쓴다. 모르는 경로는 404 와 함께 터미널에 찍히니, 화면이 비면 거기 보고 `ROUTES` 에 추가한다.
```
cd web && node dev/mock-api.mjs        # 8087
cd web && npm run dev                  # 다른 터미널
```

## 배포
아직 정하지 않았다. `Dockerfile` 은 web·api 빌드와 시험을 거쳐 한 이미지(포트 8087, 데이터 `/data` 볼륨)를 만든다.
