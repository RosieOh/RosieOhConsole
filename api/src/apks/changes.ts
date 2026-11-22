// 버전별 바뀐 점 — 이전 태그와 이 태그 사이 커밋 메시지를 비개발자가 읽을 말로.
//   "fix(child): 로그인 화면 폴드 펼침 레이아웃 — 로고/버전 균등배율" → { kind: 'fix', title: '로그인 화면 폴드 펼침 레이아웃', detail: '로고/버전 균등배율' }
// 버전 올림·머지 잡음(chore·Merge origin/…)은 뺀다. PR 머지 커밋은 같은 내용의 커밋이 없을 때만 쓴다.
export type ChangeKind = 'feat' | 'fix' | 'perf' | 'other';
export interface Change { kind: ChangeKind; title: string; detail?: string; issue?: number; sha: string }

const TYPE_RE = /^(feat|fix|perf|refactor|style|docs|test|build|ci|chore|revert)(\([^)]*\))?!?:\s*/i;

export function parseMessage(msg: string, sha = ''): Change | null {
  let line = String(msg || '').split('\n')[0].trim();
  if (!line) return null;
  let fromPr = false;
  const pr = line.match(/^Merge pull request '(.+)' \(#\d+\)/);
  if (pr) { line = pr[1]; fromPr = true; }
  else if (/^Merge (branch|remote-tracking|origin)/i.test(line)) {
    const desc = line.split(/\s—\s|\s-\s/)[1];
    if (!desc) return null;
    line = desc;
  }
  if (bumpVersion(line)) return null;   // 버전 올림 커밋은 내역에서 뺀다
  const issue = Number(line.match(/^#(\d+)\s+/)?.[1]) || undefined;
  line = line.replace(/^(#\d+\s+)+/, '').replace(/^\[[^\]]+\]\s*/, '');
  const t = line.match(TYPE_RE)?.[1]?.toLowerCase();
  if (t === 'chore' || t === 'ci' || t === 'build' || t === 'docs' || t === 'test' || t === 'style') return null;
  if (/(^(버전|version)\b)|versionName|versionCode/i.test(line.replace(TYPE_RE, ''))) return null;
  line = line.replace(TYPE_RE, '');
  line = line.replace(/\s*\+?\s*v?\d+\.\d+(\.\d+)?\s*\((vc)?\d+\)\s*$/i, '').replace(/\s*\((vc)?\d{3,}\)\s*$/i, '');
  const [title, ...rest] = line.split(/\s—\s/);
  const kind: ChangeKind = t === 'feat' ? 'feat' : t === 'fix' ? 'fix' : t === 'perf' ? 'perf' : 'other';
  return { kind, title: title.trim(), detail: rest.join(', ').trim() || undefined, issue, sha: sha.slice(0, 12), ...(fromPr ? { fromPr: true } : {}) } as Change;
}

/** 커밋들 → 바뀐 점(겹치는 제목은 한 번만, PR 머지 제목은 같은 내용의 커밋이 없을 때만) */
export function summarize(commits: { sha: string; message: string; parents?: number }[]): Change[] {
  const all = commits.map((c) => parseMessage(c.message, c.sha)).filter(Boolean) as (Change & { fromPr?: boolean })[];
  const direct = all.filter((c) => !c.fromPr);
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const seen = new Set(direct.map((c) => norm(c.title)));
  const out: Change[] = [];
  const add = (c: Change) => { const k = norm(c.title); if (out.some((x) => norm(x.title) === k)) return; out.push(c); };
  for (const c of direct) add(c);
  // PR 제목은 같은 일을 한 커밋과 단어가 반 넘게 겹치면 뺀다
  const words = (s: string) => new Set(s.toLowerCase().split(/[\s·,+/()]+/).filter((w) => w.length > 1));
  const overlap = (a: string, b: string) => { const x = words(a), y = words(b); let n = 0; for (const w of x) if (y.has(w)) n++; return n / Math.max(1, Math.min(x.size, y.size)); };
  for (const c of all.filter((x) => x.fromPr)) if (!seen.has(norm(c.title)) && !direct.some((d) => overlap(d.title, c.title) >= 0.5)) add(c);
  const order: Record<ChangeKind, number> = { feat: 0, fix: 1, perf: 2, other: 3 };
  return out.map(({ ...c }) => { delete (c as any).fromPr; return c; }).sort((a, b) => order[a.kind] - order[b.kind]);
}

// 버전 올림 커밋, 예: "chore(child): 버전 1.6.3 / 16003", "chore: 자녀앱 4.4.5 (versionCode 44015)", "release: 4.5.0", "chore(release): v1.1.1 [skip ci]"
const BUMP_RE = /^(?:#\d+\s+)*(?:chore|release)(?:\([^)]*\))?:\s*(?:자녀앱\s*)?(?:버전\s*)?v?(\d+\.\d+\.\d+)\b/i;
/** 버전 올림 커밋이면 버전("1.6.002" 는 "1.6.2"), 아니면 null */
export function bumpVersion(msg: string): string | null {
  const m = String(msg || '').split('\n')[0].trim().match(BUMP_RE);
  return m ? normVersion(m[1]) : null;
}
export const normVersion = (v: string) => v.replace(/^v/i, '').split('.').map((x) => String(Number(x))).join('.');

/** 최신부터 내려오는 커밋을 버전 올림 커밋 기준으로 나눈다. 올림 커밋과 그 아래(이전) 커밋이 그 버전 몫.
 *  가장 위의 올림 커밋보다 새 커밋은 top(보통 최신 릴리스 태그) 몫. 같은 버전이 다시 나오면 한 버전으로 합친다 */
export function splitVersions(commits: { sha: string; message: string; date: string }[], top: string | null) {
  const out: { version: string; date: string; sha: string; commits: { sha: string; message: string }[] }[] = [];
  let cur: (typeof out)[number] | null = top ? { version: normVersion(top), date: commits[0]?.date ?? '', sha: commits[0]?.sha ?? '', commits: [] } : null;
  if (cur) out.push(cur);
  for (const c of commits) {
    const v = bumpVersion(c.message);
    if (v && v !== cur?.version) {
      cur = out.find((x) => x.version === v) ?? null;
      if (!cur) { cur = { version: v, date: c.date, sha: c.sha, commits: [] }; out.push(cur); }
    }
    cur?.commits.push({ sha: c.sha, message: c.message });
  }
  return out.filter((x) => x.commits.length);
}
