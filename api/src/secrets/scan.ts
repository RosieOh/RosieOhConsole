// 시크릿·변수 사용처 — 워크플로 파일 글자에서 찾는다(값은 GitHub 이 돌려주지 않으므로 이름만 다룬다).
//   secrets.X · vars.X 참조를 모으고, `uses: <org>/<repo>/.github/workflows/<파일>@<ref>` 로 공용 템플릿을 부르면서
//   같은 파일에 `secrets: inherit` 가 있으면 템플릿 안의 secrets.X 도 "이 저장소가 템플릿을 거쳐 쓰는 것"으로 센다.
//   (명시적으로 secrets: { A: ${{ secrets.B }} } 를 넘기면 호출 파일 쪽 secrets.B 가 이미 잡힌다.)

export type RefKind = 'secret' | 'variable';
export interface Ref { kind: RefKind; name: string; optional?: boolean }   // optional = 그 줄 주석에 "없으면…/선택/optional"
export interface TemplateUse { owner: string; repo: string; path: string; ref: string; inherit: boolean }
export interface Usage { workflow: string; via?: string; optional?: boolean }   // via = 재사용 워크플로(<repo>/x.yml), optional = 없어도 되는 값

// GitHub 이 자동으로 넣어 주는 값 — 정의할 필요가 없다
export const BUILTIN = new Set(['GITHUB_TOKEN']);
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

/** 이름 검사 — GitHub 규칙: 영문·숫자·_ , 숫자로 시작 X, GITHUB_ 접두사 X */
export function checkName(name: string): string | null {
  if (!NAME_RE.test(name)) return '이름은 영문, 숫자, _ 만, 숫자로 시작할 수 없습니다';
  if (/^GITHUB_/i.test(name)) return 'GITHUB_ 로 시작하는 이름은 쓸 수 없습니다';
  return null;
}

const OPTIONAL_RE = /(없으면|없어도|선택|optional)/i;
// 앞이 글자·-·.·/ 이면 참조가 아니다(scripts/ci-secrets.sh 같은 파일 이름)
const SECRET_RE = /(?<![\w./-])secrets\.([A-Za-z_][A-Za-z0-9_]*)|(?<![\w./-])secrets\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g;
const VAR_RE = /(?<![\w./-])vars\.([A-Za-z_][A-Za-z0-9_]*)|(?<![\w./-])vars\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g;

/** 줄마다 코드(# 앞)에서 secrets.X · secrets['X'] · vars.X 를 찾는다. 같은 줄 주석이 "없으면 빈 값" 류면 선택 값 */
export function extractRefs(text: string): Ref[] {
  const out = new Map<string, Ref>();
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const at = line.search(/\s#/);
    const code = at >= 0 ? line.slice(0, at) : line;
    const optional = at >= 0 && OPTIONAL_RE.test(line.slice(at));
    const add = (kind: RefKind, name: string) => {
      if (kind === 'secret' && BUILTIN.has(name)) return;
      const k = `${kind}:${name}`;
      const prev = out.get(k);
      out.set(k, { kind, name, optional: prev ? !!prev.optional && optional : optional });
    };
    for (const m of code.matchAll(SECRET_RE)) add('secret', m[1] ?? m[2]);
    for (const m of code.matchAll(VAR_RE)) add('variable', m[1] ?? m[2]);
  }
  return [...out.values()].map((r) => (r.optional ? r : { kind: r.kind, name: r.name }));
}

/** 재사용 워크플로(다른 저장소가 부르는 템플릿)인가 — 이 안의 참조는 부르는 저장소의 값을 쓴다 */
export const isTemplate = (text: string) => /^\s*workflow_call\s*:/m.test(text);

/** 다른 저장소의 재사용 워크플로 부르기 — 같은 파일에 secrets: inherit 가 있으면 시크릿이 그대로 넘어간다 */
export function extractTemplateUses(text: string): TemplateUse[] {
  const body = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const inherit = /\bsecrets:\s*inherit\b/.test(body);
  const out: TemplateUse[] = [];
  for (const m of body.matchAll(/\buses:\s*['"]?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml)@([A-Za-z0-9_./-]+)/g)) {
    out.push({ owner: m[1], repo: m[2], path: m[3], ref: m[4], inherit });
  }
  return out;
}

export interface WorkflowFile { path: string; text: string }
export interface RepoUsage { refs: Map<string, { ref: Ref; usages: Usage[] }>; templates: TemplateUse[]; templateFiles: string[] }

/**
 * 저장소 하나의 사용처. template(owner, repo, path, ref) 는 템플릿 파일 글자(없으면 null).
 * 템플릿이 다른 템플릿을 부르는 경우도 한 단계 더(깊이 3까지) 따라간다.
 */
export async function repoUsage(files: WorkflowFile[], template: (u: TemplateUse) => Promise<string | null>): Promise<RepoUsage> {
  const refs = new Map<string, { ref: Ref; usages: Usage[] }>();
  const templates: TemplateUse[] = [];
  const templateFiles: string[] = [];
  const add = (r: Ref, u: Usage) => {
    const k = `${r.kind}:${r.name}`;
    const e = refs.get(k) ?? { ref: { kind: r.kind, name: r.name }, usages: [] };
    if (!e.usages.some((x) => x.workflow === u.workflow && x.via === u.via)) e.usages.push(r.optional ? { ...u, optional: true } : u);
    refs.set(k, e);
  };
  const walk = async (text: string, workflow: string, via: string | undefined, depth: number) => {
    for (const r of extractRefs(text)) add(r, { workflow, ...(via ? { via } : {}) });
    if (depth >= 3) return;
    for (const t of extractTemplateUses(text)) {
      if (depth === 0) templates.push(t);
      if (!t.inherit) continue;               // 시크릿을 명시적으로 넘기면 호출 쪽 참조로 이미 잡혔다
      const body = await template(t).catch(() => null);
      if (body) await walk(body, workflow, `${t.repo}/${t.path.replace(/^\.github\/workflows\//, '')}`, depth + 1);
    }
  };
  for (const f of files) {
    const wf = f.path.replace(/^\.github\/workflows\//, '');
    if (isTemplate(f.text)) { templateFiles.push(wf); continue; }   // 템플릿 안의 참조는 부르는 저장소 몫
    await walk(f.text, wf, undefined, 0);
  }
  return { refs, templates, templateFiles };
}

// ── 권한 ── 저장소 권한 이름(owner, admin, write, read, none) → 시크릿에 대해 할 수 있는 것
export type Perm = 'owner' | 'admin' | 'write' | 'read' | 'none';
const RANK: Record<Perm, number> = { none: 0, read: 1, write: 2, admin: 3, owner: 4 };
export const higher = (a: Perm, b: Perm): Perm => (RANK[a] >= RANK[b] ? a : b);
/** 바꿀 수 있다 = 저장소 설정(admin 이상). 쓸 수 있다 = 워크플로를 push 해 값을 꺼낼 수 있다(write 이상) */
export const canManage = (p: Perm) => RANK[p] >= RANK.admin;
export const canUse = (p: Perm) => RANK[p] >= RANK.write;

export interface TeamInfo { name: string; permission: Perm; allRepos: boolean; codeUnit: Perm; members: string[]; repos: string[] }

/** 팀, 직접 협업자로 저장소 권한과 근거를 계산한다(저장소 권한 결과를 설명하는 용도) */
export function explainPerm(login: string, repo: string, teams: TeamInfo[], collaborators: { login: string; perm: Perm }[]): { perm: Perm; why: string[] } {
  let perm: Perm = 'none';
  const why: string[] = [];
  for (const t of teams) {
    if (!t.members.includes(login) || !(t.allRepos || t.repos.includes(repo))) continue;
    const p = t.permission === 'owner' ? 'owner' : t.permission === 'admin' ? 'admin' : t.codeUnit;
    if (p === 'none') continue;
    perm = higher(perm, p);
    why.push(`팀 ${t.name}(${p})`);
  }
  const c = collaborators.find((x) => x.login === login);
  if (c && c.perm !== 'none') { perm = higher(perm, c.perm); why.push(`직접 협업자(${c.perm})`); }
  return { perm, why };
}

export const unitPerm = (v: unknown): Perm => (v === 'owner' || v === 'admin' || v === 'write' || v === 'read' ? v : 'none');
