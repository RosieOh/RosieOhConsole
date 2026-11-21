#!/usr/bin/env bash
# 실행 위치(의 git 저장소)에 Claude Git & GitHub 워크플로우를 설정한다 — 이 파일 하나만 복사해 다른 프로젝트에서도 쓴다
#
#   bash setup-claude.bash            설치(여러 번 돌려도 같다)
#   bash setup-claude.bash --check    지금 상태만 보기
#   bash setup-claude.bash --remove   훅·커밋 템플릿 되돌리기(CLAUDE.md·.claude 는 그대로)
#
# 하는 일
#   1) CLAUDE.md 에 Git & GitHub 규칙 구역을 넣는다. 파일이 있으면 표시된 구역만 바꾸고 나머지 내용은 둔다
#   2) git commit-msg 훅: 첫 줄 'TYPE : 본문' 검사, AI 서명(Co-Authored-By: Claude 등) 줄 지우기
#   3) git 커밋 템플릿(이 저장소에서만, .git 안에 둔다)
#   4) .claude/settings.json: 커밋·PR 의 AI 서명 끄기, 커밋·push 는 묻기, force push·reset --hard 막기(있으면 합친다, node 필요)
set -euo pipefail

MODE=install
case "${1:-}" in
  '') ;;
  --check) MODE=check ;;
  --remove) MODE=remove ;;
  -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "모르는 옵션: $1" >&2; exit 1 ;;
esac

ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git 이 필요합니다"
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || die "git 저장소 안에서 실행하세요 (지금: $PWD)"
cd "$TOP"
HOOK="$(git rev-parse --git-path hooks)/commit-msg"
TEMPLATE="$(git rev-parse --git-path commit-template.txt)"
MARK='# setup-claude: commit-msg'
BEGIN='<!-- setup-claude:git-rules:start -->'
END='<!-- setup-claude:git-rules:end -->'

status() {
  if [ -f "$HOOK" ] && grep -q "$MARK" "$HOOK"; then ok "commit-msg 훅   $HOOK"; else warn "commit-msg 훅   설치 안 됨"; fi
  if [ "$(git config --local --get commit.template || true)" = "$TEMPLATE" ]; then ok "커밋 템플릿     $TEMPLATE"; else warn "커밋 템플릿     설정 안 됨"; fi
  if [ -f CLAUDE.md ] && grep -qF "$BEGIN" CLAUDE.md; then ok "CLAUDE.md       Git 규칙 구역 있음"; else warn "CLAUDE.md       Git 규칙 구역 없음"; fi
  if [ -f .claude/settings.json ] && grep -q '"includeCoAuthoredBy": false' .claude/settings.json; then ok ".claude         AI 서명 꺼짐"; else warn ".claude         AI 서명 설정 없음"; fi
  local u e; u="$(git config --get user.name || true)"; e="$(git config --get user.email || true)"
  if [ -n "$u" ] && [ -n "$e" ]; then ok "작성자          $u"; else warn "작성자          git config user.name / user.email 이 비었습니다"; fi
  if command -v claude >/dev/null; then ok "claude          $(claude --version 2>/dev/null | head -1)"; else warn "claude          설치 안 됨 — npm i -g @anthropic-ai/claude-code"; fi
  if command -v gh >/dev/null; then ok "gh              $(gh --version | head -1)"; else warn "gh              설치 안 됨 — brew install gh && gh auth login (이슈·PR 규칙에 필요)"; fi
}

if [ "$MODE" = check ]; then status; exit 0; fi
if [ "$MODE" = remove ]; then
  if [ -f "$HOOK" ] && grep -q "$MARK" "$HOOK"; then rm "$HOOK"; ok "commit-msg 훅을 지웠습니다"; fi
  if [ "$(git config --local --get commit.template || true)" = "$TEMPLATE" ]; then git config --local --unset commit.template; rm -f "$TEMPLATE"; ok "커밋 템플릿을 지웠습니다"; fi
  exit 0
fi

echo "🚀 Claude Git & GitHub 워크플로우 설정을 시작합니다... ($TOP)"

# ── 1. CLAUDE.md ─────────────────────────────────────────
rules="$(mktemp)"; trap 'rm -f "$rules"' EXIT
cat > "$rules" <<'CLAUDE_RULES'
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
CLAUDE_RULES

if [ -f CLAUDE.md ] && grep -qF "$BEGIN" CLAUDE.md; then
  # 표시된 구역만 바꾼다
  RULES="$rules" BEGIN="$BEGIN" END="$END" perl -0pi -e '
    open my $fh, "<", $ENV{RULES} or die; local $/; my $r = <$fh>; chomp $r;
    s/\Q$ENV{BEGIN}\E.*?\Q$ENV{END}\E/$ENV{BEGIN}\n$r\n$ENV{END}/s' CLAUDE.md
  ok "CLAUDE.md 의 Git 규칙 구역을 새로 고쳤습니다"
elif [ -f CLAUDE.md ]; then
  { printf '\n%s\n' "$BEGIN"; cat "$rules"; printf '%s\n' "$END"; } >> CLAUDE.md
  ok "CLAUDE.md 끝에 Git 규칙 구역을 붙였습니다 (기존 내용은 그대로)"
else
  { printf '%s\n' "$BEGIN"; cat "$rules"; printf '%s\n' "$END"; } > CLAUDE.md
  ok "CLAUDE.md 를 만들었습니다"
fi

# ── 2. commit-msg 훅 ─────────────────────────────────────
mkdir -p "$(dirname "$HOOK")"
if [ -f "$HOOK" ] && ! grep -q "$MARK" "$HOOK"; then
  bak="$HOOK.bak-$(date +%Y%m%d-%H%M%S)"; mv "$HOOK" "$bak"; warn "기존 commit-msg 훅을 $bak 로 옮겼습니다"
fi
cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# setup-claude: commit-msg — 첫 줄 'TYPE : 본문' 검사, AI 서명 줄 지우기. 되돌리기: setup-claude.bash --remove
set -euo pipefail
f="$1"
TYPES='FEAT|FIX|DOCS|STYLE|REFACTOR|TEST|CHORE'
# git commit -v 의 가위 줄 아래(diff)와 주석은 보지 않는다
body() { sed '/^# -\{24\} >8 -\{24\}$/,$d' "$f" | grep -v '^#' || true; }

AI_RE='^[[:space:]]*(Co-Authored-By:.*(claude|anthropic|copilot|openai|chatgpt|gpt-|cursor|gemini)|.*Generated (with|by) .*(Claude|Copilot|ChatGPT)|🤖)'
if body | grep -Eiq "$AI_RE"; then
  AI_RE="$AI_RE" perl -ni -e 'print unless /$ENV{AI_RE}/i' "$f"
  perl -0pi -e 's/\n{2,}\z/\n/' "$f"
  echo "commit-msg: AI 서명 줄을 지웠습니다" >&2
fi

first="$(body | sed '/^[[:space:]]*$/d' | head -1)"
case "$first" in 'Merge '*|'Revert '*|'fixup! '*|'squash! '*|'amend! '*) exit 0 ;; esac
if ! printf '%s' "$first" | grep -Eq "^($TYPES) : [^ ]"; then
  echo "commit-msg: 첫 줄은 'TYPE : 본문' 형식이어야 합니다" >&2
  echo "  TYPE = ${TYPES//|/, }   예) FEAT : 사용자 소셜 로그인 API 연동" >&2
  echo "  지금: ${first:-(비어 있음)}" >&2
  exit 1
fi
HOOK_EOF
chmod +x "$HOOK"
ok "commit-msg 훅을 설치했습니다 ($HOOK)"

# ── 3. 커밋 템플릿 ───────────────────────────────────────
cat > "$TEMPLATE" <<'TPL_EOF'


# TYPE : 본문            (콜론 앞뒤 공백, 본문은 간결한 명사형·명령조)
#   FEAT 기능 · FIX 버그 · DOCS 문서 · STYLE 서식 · REFACTOR 구조 · TEST 시험 · CHORE 기타
# 빈 줄 다음에 자세한 내용
#   - 무엇을, 왜
# AI 서명(Co-Authored-By 등)은 넣지 않는다 — commit-msg 훅이 지운다
TPL_EOF
git config --local commit.template "$TEMPLATE"
ok "커밋 템플릿을 설정했습니다"

# ── 4. .claude/settings.json ─────────────────────────────
if command -v node >/dev/null; then
  mkdir -p .claude
  node - "$TOP/.claude/settings.json" <<'NODE_EOF'
const fs = require('fs');
const file = process.argv[2];
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`✗ ${file} 를 읽지 못했습니다(${e.message}) — 고친 뒤 다시 실행하세요`); process.exit(1); }
}
// 커밋·PR 에 AI 서명을 넣지 않는다(새 키 attribution, 옛 키 includeCoAuthoredBy)
s.attribution = { ...(s.attribution || {}), commit: '', pr: '' };
s.includeCoAuthoredBy = false;
const want = {
  allow: ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git branch:*)'],
  ask: ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)',
    'Bash(gh pr create:*)', 'Bash(gh pr merge:*)', 'Bash(gh issue create:*)'],
  deny: ['Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(git push --force-with-lease:*)',
    'Bash(git reset --hard:*)', 'Bash(git commit --no-verify:*)', 'Bash(git commit -n:*)'],
};
s.permissions = s.permissions || {};
let added = 0;
for (const [k, rules] of Object.entries(want)) {
  const cur = new Set(s.permissions[k] || []);
  for (const r of rules) if (!cur.has(r)) { cur.add(r); added++; }
  s.permissions[k] = [...cur];
}
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
console.log(`\x1b[32m✓\x1b[0m .claude/settings.json — AI 서명 끔, 권한 규칙 ${added}개 추가`);
NODE_EOF
else
  warn "node 가 없어 .claude/settings.json 은 건너뜁니다"
fi

echo
status
echo "✅ 설정이 끝났습니다. 개인 설정(이 컴퓨터에서만)은 .claude/settings.local.json 에 두세요."
