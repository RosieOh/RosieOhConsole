# 콘솔 시작하기

이 콘솔은 `GITHUB_OWNER`(기본 RosieOh) 계정의 GitHub 저장소를 한곳에서 본다.

## 처음 할 일

1. **설정 › 서비스 카탈로그**에서 그룹·프로젝트를 만들고, 저장소를 골라 구성요소로 추가한다.
2. 헬스 주소·배포 워크플로·되돌리기처럼 기술 연결이 필요한 구성요소는 `api/src/catalog/defaults.ts` 에 코드로 적는다.
3. **설정 › 권한**에서 로그인할 GitHub 계정을 추가한다. 여기 없는 계정은 로그인하지 못한다.

## 토큰

| 환경변수 | 권한(fine-grained) | 쓰는 곳 |
|---|---|---|
| `GITHUB_TOKEN` | Metadata, Contents, Actions: read (+ Administration: read 면 셀프 호스티드 러너까지) | 저장소·실행 기록·릴리스 읽기 |
| `GITHUB_WRITE_TOKEN` | Actions, Contents, Pull requests, Variables: write | 되돌리기·운영 반영·서버 점검 요청·변수 바꾸기 |

토큰이 없으면 공개 API 한도(시간당 60회)로 돈다.
