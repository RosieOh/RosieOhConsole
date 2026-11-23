// 업무 보드 저장소 찾기 — 주인 저장소 + 내가 속한 모든 조직(+ GITHUB_ORGS)에서 찾는다.
// GraphQL search 를 별칭 여러 개로 한 번에 부른다(REST 한도를 쓰지 않는다). GitHub 검색 질의는 256자까지라 조직을 나눠 담는다
export const SEARCH_MAX = 240;
export const RESULT_MAX = 30;

export interface FoundRepo { repo: string; owner: string; description: string; private: boolean; updated: string | null; archived: boolean }

/** 검색어 — 저장소 이름에 쓰는 글자만(검색 문법·따옴표가 끼어들지 않게) */
export function cleanText(q: string) { return q.replace(/[^\w.\-가-힣 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50); }

/** "조직/저장소" 를 그대로 넣었으면 그 저장소를 직접 찾는다 */
export function directRepo(q: string): { owner: string; name: string } | null {
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(q.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/** 질의 여러 개 — 검색어 + user:/org: 묶음. 각 질의가 SEARCH_MAX 를 넘지 않게 나눈다 */
export function searchQueries(text: string, owner: string, orgs: string[]): string[] {
  const base = `${text ? `${text} in:name ` : ''}fork:true sort:updated`;
  const quals = [`user:${owner}`, ...[...new Set(orgs)].filter((o) => o.toLowerCase() !== owner.toLowerCase()).map((o) => `org:${o}`)];
  const out: string[] = [];
  let cur: string[] = [];
  for (const q of quals) {
    if (cur.length && `${base} ${[...cur, q].join(' ')}`.length > SEARCH_MAX) { out.push(`${base} ${cur.join(' ')}`); cur = []; }
    cur.push(q);
  }
  if (cur.length) out.push(`${base} ${cur.join(' ')}`);
  return out;
}

const REPO_FIELDS = 'nameWithOwner owner { login } description isPrivate isArchived pushedAt';
/** 별칭 s0, s1 … 검색 + (있으면) 직접 찾기 d */
export function searchGraphql(queries: string[], direct: { owner: string; name: string } | null): string {
  const parts = queries.map((q, i) => `s${i}: search(query: ${JSON.stringify(q)}, type: REPOSITORY, first: ${RESULT_MAX}) { nodes { ... on Repository { ${REPO_FIELDS} } } }`);
  if (direct) parts.push(`d: repository(owner: ${JSON.stringify(direct.owner)}, name: ${JSON.stringify(direct.name)}) { ${REPO_FIELDS} }`);
  return `query { ${parts.join('\n')} }`;
}

/** 콘솔 안 저장소 이름 — 주인 저장소는 이름만, 조직 저장소는 '<조직>/<저장소>' (config.full 과 같은 규칙) */
export function consoleName(nameWithOwner: string, owner: string) {
  const [o, n] = nameWithOwner.split('/');
  return o.toLowerCase() === owner.toLowerCase() ? n : nameWithOwner;
}

/** 질의 결과 → 저장소 목록(겹침 빼고 최근 수정 순, 보관(archived)은 뒤로) */
export function collect(data: any, owner: string): FoundRepo[] {
  const nodes: any[] = [];
  for (const [k, v] of Object.entries<any>(data || {})) {
    if (k === 'd') { if (v?.nameWithOwner) nodes.push(v); continue; }
    if (/^s\d+$/.test(k)) nodes.push(...((v?.nodes || []) as any[]).filter((n) => n?.nameWithOwner));
  }
  const seen = new Map<string, FoundRepo>();
  for (const n of nodes) {
    const repo = consoleName(n.nameWithOwner, owner);
    if (!seen.has(repo)) seen.set(repo, { repo, owner: n.owner?.login || n.nameWithOwner.split('/')[0], description: n.description || '', private: !!n.isPrivate, updated: n.pushedAt || null, archived: !!n.isArchived });
  }
  const direct = data?.d?.nameWithOwner ? consoleName(data.d.nameWithOwner, owner) : null;
  return [...seen.values()].sort((a, b) =>
    Number(b.repo === direct) - Number(a.repo === direct) || Number(a.archived) - Number(b.archived) || (Date.parse(b.updated || '') || 0) - (Date.parse(a.updated || '') || 0),
  ).slice(0, RESULT_MAX);
}
