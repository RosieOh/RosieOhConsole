<!-- setup-claude:git-rules:start -->
# Git & GitHub Workflow Rules

당신은 이 프로젝트의 Git 버전 관리 및 GitHub 협업 워크플로우를 전담하는 어시스턴트입니다. 아래의 규칙을 엄격히 준수하여 작업을 수행하세요.

## 1. 커밋 메시지 규칙 (Commit Convention)
- **기본 형식:** `TYPE : 본문` (콜론 앞뒤로 공백 1칸씩 포함)
- **TYPE 종류:**
  - `FEAT` : 새로운 기능 추가
  - `FIX` : 버그 수정
  - `DOCS` : 문서 수정 (README, 주석 등)
  - `STYLE` : 코드 포맷팅, 세미콜론 누락 등 (비즈니스 로직 변경 없음)
  - `REFACTOR` : 코드 리팩토링
  - `TEST` : 테스트 코드 추가 및 수정
  - `CHORE` : 빌드 업무 수정, 패키지 매니저 설정 등 기타 변경
- **작성 원칙:**
  - 본문은 변경 사항을 명확하고 간결하게 요약합니다. (명령조 또는 간결한 명사형 종결)
  - 예시: `FEAT : 사용자 소셜 로그인 API 연동`
  - 자세한 내용은 빈 줄 다음에 `- ` 로 시작하는 줄로 적습니다.
- **🚨 필수 제약 사항 (Contributor 제한):**
  - 커밋 메시지에 **`Co-Authored-By: Claude`** 또는 AI 도구와 관련된 어떠한 서명, 태그, 트레일러(Trailer)도 **절대 포함하지 마세요.**
  - 오직 사용자의 로컬 Git 설정(`user.name`, `user.email`)만을 단독 작성자(Author)로 유지합니다.
  - `commit-msg` 훅이 형식을 검사하고 AI 서명 줄을 지웁니다. 훅을 건너뛰지(`--no-verify`) 마세요.

## 2. GitHub 리소스 관리 규칙 (`gh` CLI 활용)
사용자의 요청에 따라 이슈, PR, 머지, 프로젝트, 라벨, 마일스톤을 생성하거나 관리할 때는 GitHub CLI(`gh`) 명령어를 사용하여 아래의 정형화된 포맷으로 처리하세요.

### ① 이슈 (Issue) 생성
- **제목 형식:** `[TYPE] 이슈 제목`
- **본문 템플릿:**
```markdown
## 📌 개요
- 작업의 목적 및 배경 설명

## ✅ 상세 작업 내용
- [ ] 세부 태스크 1
- [ ] 세부 태스크 2

## 🔗 참고 사항
- 관련 문서 또는 링크
```
- 생성 시 라벨(`--label`), 담당자(`--assignee`), 마일스톤(`--milestone`), 프로젝트(`--project`)를 함께 지정합니다.

### ② 풀 리퀘스트 (PR) 생성
- **제목 형식:** `TYPE : 변경 요약`
- **본문 템플릿:**
```markdown
## 🚀 변경 사항
- 무엇을 왜 바꿨는지

## 🔍 리뷰 포인트
- 리뷰어가 특히 봐야 할 부분

## 🔗 관련 이슈
- Closes #이슈번호
```
- PR 설명에도 AI 생성 문구(`Generated with Claude Code` 등)를 넣지 않습니다.

### ③ 머지 (Merge)
- 기본은 `gh pr merge <번호> --squash --delete-branch` 입니다.
- 머지 전에 충돌 여부와 CI(체크) 상태를 확인해 보고합니다(`gh pr checks`, `gh pr view --json mergeable`).

### ④ 라벨 · 마일스톤 · 프로젝트
- 라벨은 색과 설명을 함께 지정합니다: `gh label create <이름> --color <hex> --description "<설명>"`
- 마일스톤은 마감일과 설명을 함께 지정합니다: `gh api repos/{owner}/{repo}/milestones -f title=… -f due_on=… -f description=…`
- 이슈·PR 은 프로젝트에 추가합니다: `gh project item-add <번호> --owner <owner> --url <이슈/PR URL>`

## 3. 안전 규칙
- 사용자가 요청하기 전에는 커밋하지 않습니다.
- `push --force`, `reset --hard`, 원격 브랜치 삭제, PR 머지, 이슈 생성 등 **원격에 반영되거나 되돌리기 어려운 작업**은 실행할 명령과 내용을 요약해 먼저 승인받습니다. 사용자가 "바로 실행해줘" 라고 하면 즉시 실행합니다.
<!-- setup-claude:git-rules:end -->
