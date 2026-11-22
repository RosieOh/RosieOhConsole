# scripts

저장소 루트 어디서든 `scripts/<이름>.bash` 로 실행한다. 모두 `-h` 로 사용법이 나온다. macOS 기본 bash(3.2)·node 22 이상·perl 로 돈다.

## 만들기

| 스크립트 | 하는 일 |
|---|---|
| `new-feature.bash <이름> --title 제목` | API 모듈 + 웹 화면을 한 번에(아래 둘을 차례로) |
| `new-api.bash <이름>` | `api/src/<이름>/`(controller·service·model) + `api/test/<이름>.test.mjs` + `app.module.ts` 등록 |
| `new-page.bash <이름> --title 제목` | `web/src/components/<Pascal>.tsx` + `api.ts` 함수·타입 + `App.tsx` 메뉴·라우팅 + 가짜 API 응답 |
| `new-app.bash <key> --name 이름 --kind 종류 --group 그룹` | 카탈로그(`api/src/catalog/defaults.ts`)에 애플리케이션 추가. `--create-repo` 면 GitHub 저장소도 |
| `new-server.bash <id> --name 이름 --repo 저장소 --ssh user@host` | 점검할 서버를 `api/src/infra/defaults.ts` 에 등록하고, 그 저장소에 넣을 `probe.yml`(재사용 워크플로 `server-probe.yml` 호출)을 만든다 |

공통 옵션
- `--guard none|deployer|admin` — API 권한. admin 이면 메뉴도 관리자에게만 보인다
- `--store` — `DATA_DIR/<이름>.json` 에 저장하는 CRUD(GET·POST·DELETE, rev 로 동시 편집 막기). 없으면 읽기 전용 + 30초 캐시
- `--group home|deploy|infra|board|dev|settings` · `--icon <lucide 아이콘>` — 화면이 들어갈 메뉴 묶음과 아이콘
- `--check` — 만든 뒤 빌드·시험

```sh
scripts/new-feature.bash build-cache --title "빌드 캐시" --group infra --icon Database --guard deployer --store --check
scripts/new-app.bash rosie-notes --name "Rosie Notes" --kind web --group web --note "메모 앱"
```

## 개발

| 스크립트 | 하는 일 |
|---|---|
| `setup-env.bash` | `.env.example` → `.env`, `SESSION_SECRET` 생성, 빈 값은 물어서 채움 |
| `set-password.bash <아이디>` | 계정 비밀번호를 터미널에서 정한다(입력 숨김). 처음 관리자는 계정이 없어도 만든다 — GitHub 로그인 전이나 비밀번호를 잊었을 때 |
| `db-backup.bash [--prod]` | MariaDB 덤프를 `backups/` 에 압축 저장, 최근 7개만 남김(`KEEP`·`BACKUP_DIR`). `--prod` 는 `deploy/compose.prod.yml` 의 DB |
| `dev.bash [--mock]` | api(8087) + web(Vite 5173) 을 같이 띄우고 Ctrl+C 로 둘 다 끔. `--mock` 은 토큰 없이 가짜 API |
| `check.bash [api\|web] [--build]` | api 빌드·시험, web 타입 검사·시험 — 커밋 전에 |
| `git/setup-claude.bash [--check\|--remove]` | CLAUDE.md 에 Git·GitHub 규칙, commit-msg 훅(`TYPE : 본문` 검사·AI 서명 제거), 커밋 템플릿, `.claude/settings.json`. 파일 하나로 다른 저장소에서도 쓴다 |

## 구조

- `function/common.bash` — 로그·확인·이름 바꾸기(kebab → Pascal/camel)·템플릿 채우기(`render`)·`.env` 읽기
- `function/patch.mjs` — 기존 소스의 기준 줄을 찾아 끼우는 곳. 기준 줄을 못 찾으면 파일을 건드리지 않고 실패한다. `App.tsx`·`app.module.ts`·`defaults.ts` 의 모양을 바꾸면 여기를 같이 고친다
- `templates/` — 생성되는 코드의 원본. `__NAME__`·`__PASCAL__`·`__CAMEL__`·`__TITLE__`·`__ICON__` 가 채워진다
