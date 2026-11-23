import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { audit } from '../core/audit.js';
import { cfg, full, REPO_RE } from '../core/config.js';
import { ghFetch, ghJson, ghPaged, ownerRepos } from '../core/github.js';
import { sealSecret } from './seal.js';
import {
  Perm, RefKind, TeamInfo, TemplateUse, Usage, WorkflowFile, canManage, canUse, checkName, explainPerm, repoUsage, unitPerm,
} from './scan.js';

// 시크릿·변수 — 저장소별 목록(이름만), 사용처(워크플로·재사용 워크플로 경유), 바꿀 수 있는 사람·쓸 수 있는 사람.
// 읽기는 콘솔 읽기 토큰, 바꾸기는 쓰기 토큰(GITHUB_WRITE_TOKEN). 값은 받아서 GitHub 으로 넘기기만 한다 — 로그·응답·감사에 남기지 않는다.
// GitHub 사용자 계정엔 조직 시크릿·팀이 없다 — 'org' 범위는 늘 비어 있다(타입은 조직 계정으로 옮길 때를 위해 둔다).

export interface Item {
  scope: string;                      // 'org' 또는 저장소 이름
  kind: RefKind; name: string; created?: string | null; description?: string;
  value?: string;                     // 변수만(시크릿 값은 GitHub 도 돌려주지 않는다)
  usedBy: (Usage & { repo: string })[];
  status: 'used' | 'unused' | 'missing' | 'optional';   // optional = 정의 없지만 쓰는 곳이 모두 "없어도 됨"
  overrides?: boolean;                // 저장소 값이 조직 값을 덮는다
  overriddenIn?: string[];            // (조직 값) 이 저장소들에선 저장소 값이 이긴다
}
export interface PersonPerm { login: string; perm: Perm; why: string[]; manage: boolean; use: boolean }
export interface RepoView { repo: string; archived: boolean; defaultBranch: string; workflows: string[]; templates: string[]; templateFiles: string[]; people: PersonPerm[]; error?: string }
export interface Overview {
  updatedAt: string; org: string; items: Item[]; repos: RepoView[];
  orgOwners: string[]; teams: { name: string; permission: Perm; allRepos: boolean; members: string[] }[];
  write: { repo: boolean; org: boolean; reason: string | null };
  warnings: string[];
}

const TTL = 10 * 60 * 1000;
const POOL = 6;
const VALUE_MAX = 64 * 1024;

async function pool<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}

async function raw(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(`repos/${owner}/${repo}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.raw' } });
  if (!res.ok) return null;
  const t = await res.text();
  return t.length > 512 * 1024 ? null : t;
}

@Injectable()
export class SecretsService {
  private snap: { at: number; data: Overview } | null = null;
  private inflight: Promise<Overview> | null = null;
  private orgRepos = new Set<string>();

  async overview(force = false): Promise<Overview> {
    if (!force && this.snap && Date.now() - this.snap.at < TTL) return this.snap.data;
    this.inflight ??= this.build().then((data) => { this.snap = { at: Date.now(), data }; return data; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async writeAccess(probeRepo?: string): Promise<Overview['write']> {
    if (!cfg.githubWriteToken) return { repo: false, org: false, reason: '콘솔에 쓰기 토큰(GITHUB_WRITE_TOKEN)이 없습니다' };
    const r = probeRepo ? (await ghFetch(`repos/${full(probeRepo)}/actions/variables`, {}, cfg.githubWriteToken)).status : 0;
    return { repo: r === 200, org: false, reason: r === 200 ? null : '쓰기 토큰에 저장소 Secrets·Variables 권한이 없습니다' };
  }

  private async build(): Promise<Overview> {
    const org = cfg.owner;
    const warnings: string[] = [];
    const repos = (await ownerRepos()).filter((r) => !r.fork).sort((a, b) => a.name.localeCompare(b.name));
    this.orgRepos = new Set(repos.map((r) => r.name));
    const orgSecrets: any[] = [];
    const orgVars: any[] = [];
    const teams: TeamInfo[] = [];
    const write = await this.writeAccess(repos.find((r) => !r.archived)?.name);
    const orgOwners = [cfg.owner.toLowerCase()];
    const people = [cfg.owner.toLowerCase()];

    const tplCache = new Map<string, Promise<string | null>>();
    const template = (u: TemplateUse) => {
      const k = `${u.owner}/${u.repo}/${u.path}@${u.ref}`;
      if (!tplCache.has(k)) tplCache.set(k, raw(u.owner, u.repo, u.path, u.ref));
      return tplCache.get(k)!;
    };

    const items: Item[] = [];
    const orgUse = new Map<string, (Usage & { repo: string })[]>();      // 조직 값을 쓰는 곳
    const orgOverridden = new Map<string, string[]>();                    // 저장소 값이 조직 값을 덮는 곳
    const repoViews = await pool(repos, POOL, async (r: any): Promise<RepoView> => {
      const name = r.name as string;
      const ref = r.default_branch || 'main';
      const view: RepoView = { repo: name, archived: !!r.archived, defaultBranch: ref, workflows: [], templates: [], templateFiles: [], people: [] };
      try {
        const [secrets, vars, collabs, ...dirs] = await Promise.all([
          ghPaged<any>(`repos/${full(name)}/actions/secrets`, 100, 5, 'secrets').catch(() => []),
          ghPaged<any>(`repos/${full(name)}/actions/variables`, 30, 5, 'variables').catch(() => []),
          ghPaged<any>(`repos/${full(name)}/collaborators`).catch(() => []),
          ghJson<any[]>(`repos/${full(name)}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`).catch(() => null),
        ]);
        const paths = dirs.flatMap((d) => (Array.isArray(d) ? d : [])).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name)).map((f) => f.path as string);
        const files: WorkflowFile[] = (await Promise.all(paths.map(async (p) => ({ path: p, text: (await raw(...(full(name).split('/') as [string, string]), p, ref)) ?? '' })))).filter((f) => f.text);
        view.workflows = files.map((f) => f.path.replace(/^\.github\/workflows\//, ''));
        const usage = await repoUsage(files, template);
        view.templateFiles = usage.templateFiles;
        view.templates = [...new Set(usage.templates.map((t) => `${t.repo}/${t.path.replace(/^\.github\/workflows\//, '')}${t.inherit ? '' : ' (시크릿 직접 전달)'}`))];

        const collaborators = collabs.map((c: any) => ({
          login: String(c.login).toLowerCase(),
          perm: (c.permissions?.admin ? 'admin' : c.permissions?.push ? 'write' : c.permissions?.pull ? 'read' : 'none') as Perm,
        }));
        const logins = [...new Set([...people, ...collaborators.map((c) => c.login)])];
        view.people = logins.map((login) => {
          const { perm, why } = explainPerm(login, name, teams, collaborators);
          return { login, perm, why, manage: canManage(perm), use: canUse(perm) };
        }).filter((p) => p.perm !== 'none').sort((a, b) => a.login.localeCompare(b.login));

        const used = (kind: RefKind, n: string) => (usage.refs.get(`${kind}:${n}`)?.usages ?? []).map((u) => ({ ...u, repo: name }));
        const orgSecretNames = new Set(orgSecrets.map((s: any) => s.name));
        const orgVarNames = new Set(orgVars.map((v: any) => v.name));
        for (const s of secrets) {
          const u = used('secret', s.name);
          items.push({ scope: name, kind: 'secret', name: s.name, created: s.created_at ?? null, description: s.description || '', usedBy: u,
            status: u.length ? 'used' : 'unused', overrides: orgSecretNames.has(s.name) });
        }
        for (const v of vars) {
          const u = used('variable', v.name);
          items.push({ scope: name, kind: 'variable', name: v.name, value: v.value ?? '', description: v.description || '', usedBy: u,
            status: u.length ? 'used' : 'unused', overrides: orgVarNames.has(v.name) });
        }
        // 쓰는데 어디에도 없다 — 실행하면 빈 값(대개 실패)
        const repoSecretNames = new Set(secrets.map((s: any) => s.name));
        const repoVarNames = new Set(vars.map((v: any) => v.name));
        for (const { ref: rf, usages } of usage.refs.values()) {
          const defined = rf.kind === 'secret' ? repoSecretNames.has(rf.name) || orgSecretNames.has(rf.name) : repoVarNames.has(rf.name) || orgVarNames.has(rf.name);
          if (!defined) items.push({ scope: name, kind: rf.kind, name: rf.name, usedBy: usages.map((u) => ({ ...u, repo: name })), status: usages.every((u) => u.optional) ? 'optional' : 'missing' });
          // 조직 값을 쓰는 사용처는 조직 항목에 붙인다(아래)
          if (!(rf.kind === 'secret' ? repoSecretNames : repoVarNames).has(rf.name)) {
            const key = `${rf.kind}:${rf.name}`;
            orgUse.set(key, [...(orgUse.get(key) || []), ...usages.map((u) => ({ ...u, repo: name }))]);
          }
          if ((rf.kind === 'secret' ? repoSecretNames : repoVarNames).has(rf.name) && (rf.kind === 'secret' ? orgSecretNames : orgVarNames).has(rf.name)) {
            const key = `${rf.kind}:${rf.name}`;
            orgOverridden.set(key, [...(orgOverridden.get(key) || []), name]);
          }
        }
      } catch (e: any) {
        view.error = `읽지 못했습니다(${e?.message})`;
      }
      return view;
    });

    for (const s of orgSecrets) {
      const u = orgUse.get(`secret:${s.name}`) || [];
      items.push({ scope: 'org', kind: 'secret', name: s.name, created: s.created_at ?? null, description: s.description || '', usedBy: u,
        status: u.length ? 'used' : 'unused', overriddenIn: orgOverridden.get(`secret:${s.name}`) || [] });
    }
    for (const v of orgVars) {
      const u = orgUse.get(`variable:${v.name}`) || [];
      items.push({ scope: 'org', kind: 'variable', name: v.name, value: v.value ?? '', description: v.description || '', usedBy: u,
        status: u.length ? 'used' : 'unused', overriddenIn: orgOverridden.get(`variable:${v.name}`) || [] });
    }

    return {
      updatedAt: new Date().toISOString(), org, items, repos: repoViews, orgOwners,
      teams: teams.map((t) => ({ name: t.name, permission: t.permission === 'none' ? t.codeUnit : t.permission, allRepos: t.allRepos, members: t.members })),
      write, warnings,
    };
  }

  // ── 바꾸기 ── 관리자만(컨트롤러). 교체, 삭제는 이름을 다시 입력해야 한다
  private target(scope: string, repo?: string) {
    if (scope === 'org') throw new BadRequestException('사용자 계정엔 조직 시크릿, 변수가 없습니다');
    if (scope !== 'repo' || !repo || !REPO_RE.test(repo)) throw new BadRequestException('저장소를 고르세요');
    if (this.orgRepos.size && !this.orgRepos.has(repo)) throw new NotFoundException('콘솔이 다루는 저장소가 아닙니다');
    return { base: `repos/${full(repo)}`, label: repo };
  }

  private async send(path: string, method: string, body?: unknown) {
    if (!cfg.githubWriteToken) throw new ServiceUnavailableException('콘솔에 쓰기 토큰(GITHUB_WRITE_TOKEN)이 없습니다');
    const res = await ghFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }, cfg.githubWriteToken);
    if (res.status === 401 || res.status === 403) throw new ForbiddenException('토큰 권한 부족, 이 동작은 GitHub 저장소 설정에서 하세요');
    return res;
  }

  private async exists(base: string, kind: RefKind, name: string) {
    const list = await ghPaged<any>(`${base}/actions/${kind === 'secret' ? 'secrets' : 'variables'}`, 30, 5, kind === 'secret' ? 'secrets' : 'variables');
    return list.some((x) => x.name === name);
  }

  usersOf(scope: string, repo: string | undefined, kind: RefKind, name: string) {
    const items = this.snap?.data.items || [];
    const it = items.find((i) => i.kind === kind && i.name === name && i.scope === (scope === 'org' ? 'org' : repo));
    return it?.usedBy ?? [];
  }

  async set(login: string, b: { scope?: string; repo?: string; kind?: RefKind; name?: string; value?: string; confirm?: string; description?: string }) {
    const kind = b.kind === 'variable' ? 'variable' : b.kind === 'secret' ? 'secret' : null;
    if (!kind) throw new BadRequestException('종류는 secret, variable 입니다');
    const name = String(b.name || '').trim();
    const bad = checkName(name);
    if (bad) throw new BadRequestException(bad);
    const value = typeof b.value === 'string' ? b.value : '';
    if (!value) throw new BadRequestException('값을 넣으세요');
    if (Buffer.byteLength(value) > VALUE_MAX) throw new BadRequestException('값은 64KB 이하입니다');
    const t = this.target(String(b.scope), b.repo);
    const had = await this.exists(t.base, kind, name).catch(() => false);
    if (had && b.confirm !== name) throw new BadRequestException(`이미 있는 ${kind === 'secret' ? '시크릿' : '변수'}입니다, 바꾸려면 이름 "${name}" 을 그대로 입력하세요`);
    const desc = b.description !== undefined ? String(b.description).slice(0, 200) : undefined;
    let res: Response;
    void desc;   // GitHub 시크릿·변수엔 설명 칸이 없다
    if (kind === 'secret') {
      // 저장소 공개키로 봉인해서 보낸다 — 평문 값은 GitHub 으로도, 로그·감사로도 가지 않는다
      const pk = await this.send(`${t.base}/actions/secrets/public-key`, 'GET');
      if (!pk.ok) throw new BadRequestException(`저장소 공개키를 받지 못했습니다(HTTP ${pk.status})`);
      const { key, key_id } = await pk.json() as { key: string; key_id: string };
      const encrypted_value = await sealSecret(value, key);
      res = await this.send(`${t.base}/actions/secrets/${encodeURIComponent(name)}`, 'PUT', { encrypted_value, key_id });
    } else {
      res = had
        ? await this.send(`${t.base}/actions/variables/${encodeURIComponent(name)}`, 'PATCH', { name, value })
        : await this.send(`${t.base}/actions/variables`, 'POST', { name, value });
    }
    const ok = res.ok;
    await audit({ login, action: `${kind}.${had ? 'replace' : 'create'}`, target: `${t.label}/${name}`, detail: had ? '값 교체' : '새로 만듦', ok });
    if (!ok) throw new BadRequestException(`GitHub 이 HTTP ${res.status} 로 거절했습니다`);
    const usedBy = this.usersOf(String(b.scope), b.repo, kind, name);
    this.snap = null;
    return { ok: true, created: !had, usedBy };
  }

  async remove(login: string, b: { scope?: string; repo?: string; kind?: RefKind; name?: string; confirm?: string }) {
    const kind = b.kind === 'variable' ? 'variable' : b.kind === 'secret' ? 'secret' : null;
    if (!kind) throw new BadRequestException('종류는 secret, variable 입니다');
    const name = String(b.name || '').trim();
    if (checkName(name)) throw new BadRequestException('이름이 올바르지 않습니다');
    if (b.confirm !== name) throw new BadRequestException(`지우려면 이름 "${name}" 을 그대로 입력하세요`);
    const t = this.target(String(b.scope), b.repo);
    const usedBy = this.usersOf(String(b.scope), b.repo, kind, name);
    const res = await this.send(`${t.base}/actions/${kind === 'secret' ? 'secrets' : 'variables'}/${encodeURIComponent(name)}`, 'DELETE');
    const ok = res.ok || res.status === 404;
    await audit({ login, action: `${kind}.delete`, target: `${t.label}/${name}`, detail: usedBy.length ? `쓰는 곳 ${usedBy.length}곳` : '쓰는 곳 없음', ok });
    if (!ok) throw new BadRequestException(`GitHub 이 HTTP ${res.status} 로 거절했습니다`);
    this.snap = null;
    return { ok: true, usedBy };
  }
}

