import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { listAccess } from '../access/access.js';
import { audit } from '../core/audit.js';
import { sessionOf } from '../auth/session.js';
import { REPO_RE, cfg, full, originOk } from '../core/config.js';
import { CROSS_ORIGIN } from '../core/http.js';
import { ghFetch, ghGraphql, ghJson } from '../core/github.js';
import { cleanText, collect, directRepo, searchGraphql, searchQueries } from './repo-search.js';
import { JsonStore, Versioned } from '../core/json-store.js';
import { isSafeKey } from '../core/safe.js';
import { BLOCKED_LABEL, Card, GqlIssue, STAGES, STAGE_COLOR, STAGE_KO, STAGE_LABEL, Stage, draftReport, stageLabels, toCard } from './derive.js';

// 업무보드 — GitHub Issues·PR 로 만든 칸반과 주간보고. 화면은 web/src/board(같은 SPA), API 는 /board/api/*(main.ts 가 넘긴다)
//   카드 = 따라가는 저장소들의 이슈(열린 것 + 최근 14일 안에 닫힌 것). 단계·깃발은 derive.ts
//   쓰기(단계 옮기기·막힘·닫기)는 GITHUB_WRITE_TOKEN 으로 라벨·상태를 바꾼다. 없으면 읽기 전용
//   따라가는 저장소·열람 명단·주간보고 편집은 문서 'board'(MariaDB, 없으면 DATA_DIR/board.json)

interface Report { text: string; by: string; at: string; reflectedAt?: string; reflectedBy?: string; reflectedText?: string }
interface BoardDoc extends Versioned {
  repos: { repo: string; type: string }[];
  viewers: string[];                                   // 비어 있으면 로그인한 누구나 본다
  reports: Record<string, Record<string, Report>>;     // 주(2026-W47) → 프로젝트(저장소) → 편집
}
interface Unlinked { kind: 'pr'; repo: string; number: number; title: string; author: string; updated: string | null; url: string; draft: boolean }

const TYPES: Record<string, string> = { backend: '백엔드', web: '웹', app: '앱', tool: '도구', etc: '기타' };
const CACHE_MS = 30_000;
const CLOSED_KEEP_MS = 14 * 86400_000;
const DEFAULT_REPOS = () => [{ repo: process.env.BOARD_DEFAULT_REPO || 'RosieOhConsole', type: 'web' }];

const QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
  open:issues(first:100,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{...I}}
  closed:issues(first:40,states:CLOSED,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{...I}}
  pullRequests(first:40,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url isDraft updatedAt author{login} closingIssuesReferences{totalCount}}}
}}
fragment I on Issue{number title url state stateReason createdAt updatedAt closedAt
  assignees(first:10){nodes{login}} labels(first:30){nodes{name}} milestone{title dueOn}
  closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number state isDraft merged reviewDecision mergeable commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`;

/** ISO 주(월요일 시작) — 2026-W47, 그 주 월요일 0시 */
export function isoWeek(t = Date.now()): { key: string; start: number } {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;                          // 월=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { key: `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`, start: monday.getTime() };
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

@Injectable()
export class BoardService {
  private readonly store = new JsonStore<BoardDoc>(`${cfg.dataDir}/board.json`, () => ({ rev: 0, repos: DEFAULT_REPOS(), viewers: [], reports: {} }));
  private cache: { at: number; cards: Card[]; unlinked: Unlinked[]; warnings: string[] } | null = null;
  private inflight: Promise<NonNullable<BoardService['cache']>> | null = null;

  get enabled() { return true; }

  /** /board/api/* — 보드 코드의 경로는 /api/… 와 /healthz(main.ts 가 붙인다) */
  async handle(req: Request, res: Response) {
    const send = (status: number, body: unknown) => { if (!res.headersSent) res.status(status).json(body); };
    try {
      const out = await this.route(req);
      send(200, out);
    } catch (e: any) {
      if (e instanceof HttpError) send(e.status, { ok: false, error: e.message });
      else { console.error('[보드] 처리 실패:', e?.message); send(500, { ok: false, error: '보드 처리 중 오류' }); }
    }
  }

  private async route(req: Request): Promise<unknown> {
    const [path, qs] = req.url.split('?');
    const q = new URLSearchParams(qs || '');
    if (path === '/healthz') return { ok: true };
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, '로그인이 필요합니다');
    const me = s.login.toLowerCase();
    const doc = this.store.get();
    const viewer = s.admin || !doc.viewers.length || doc.viewers.includes(me);
    if (req.method === 'GET' && path === '/api/me') return { login: s.login, admin: s.admin, viewer };
    if (!viewer) throw new HttpError(403, '업무보드 열람 명단에 없습니다. 관리자에게 요청하세요');

    if (req.method === 'GET') {
      if (path === '/api/board') return this.boardView(q.get('refresh') === '1');
      if (path === '/api/viewers') return this.viewersView();
      if (path === '/api/repos') return this.reposView(String(q.get('q') || ''));
      if (path === '/api/report') return this.reportView();
      throw new HttpError(404, '없는 경로입니다');
    }
    if (req.method !== 'POST') throw new HttpError(405, '허용하지 않는 방법입니다');
    if (!originOk(req.get('origin'))) throw new HttpError(403, CROSS_ORIGIN);
    const b = await readJson(req);
    switch (path) {
      case '/api/move': return this.move(s, b, b.to);
      case '/api/follow': return this.move(s, b, null);
      case '/api/blocked': return this.blocked(s, b);
      case '/api/state': return this.close(s, b);
      case '/api/viewers': return this.changeViewer(s, b);
      case '/api/repos': return this.changeRepo(s, b);
      case '/api/report': return this.reportAct(s, b);
    }
    throw new HttpError(404, '없는 경로입니다');
  }

  // ── 읽기 ──
  private async load(force: boolean) {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    this.inflight ??= this.fetchAll().then((c) => (this.cache = c)).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetchAll() {
    const warnings: string[] = [];
    if (!cfg.githubToken) return { at: Date.now(), cards: [], unlinked: [], warnings: ['GITHUB_TOKEN 이 없어 업무보드를 읽을 수 없습니다(GraphQL 은 토큰이 필요합니다)'] };
    const repos = this.store.get().repos;
    if (!repos.length) warnings.push('따라가는 저장소가 없습니다. 저장소 관리에서 추가하세요');
    const cards: Card[] = [];
    const unlinked: Unlinked[] = [];
    const now = Date.now();
    await Promise.all(repos.map(async ({ repo }) => {
      const [owner, name] = full(repo).split('/');
      try {
        const d = await ghGraphql<any>(QUERY, { owner, name });
        const r = d?.repository;
        if (!r) { warnings.push(`${repo}: 저장소를 찾지 못했습니다`); return; }
        for (const i of r.open.nodes as GqlIssue[]) cards.push(toCard(repo, i, now));
        for (const i of r.closed.nodes as GqlIssue[]) if (i.closedAt && now - Date.parse(i.closedAt) < CLOSED_KEEP_MS) cards.push(toCard(repo, i, now));
        for (const p of r.pullRequests.nodes) if (!p.closingIssuesReferences?.totalCount) {
          unlinked.push({ kind: 'pr', repo, number: p.number, title: p.title, author: p.author?.login || '', updated: p.updatedAt, url: p.url, draft: !!p.isDraft });
        }
      } catch (e: any) { warnings.push(`${repo}: 읽지 못했습니다(${e?.message})`); }
    }));
    cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { at: now, cards, unlinked, warnings };
  }

  private async boardView(force: boolean) {
    const c = await this.load(force);
    return {
      columns: STAGES.map((key) => ({ key, title: STAGE_KO[key], cards: c.cards.filter((x) => x.stage === key) })),
      batchAt: new Date(c.at).toISOString(), counts: {}, warning: c.warnings.join(' · '),
      readonly: !cfg.githubWriteToken, unlinked: c.unlinked, unlinkedAt: new Date(c.at).toISOString(),
    };
  }

  private viewersView() {
    const a = listAccess();
    const admins = [...new Set([...a.roots, ...Object.entries(a.users).filter(([, u]) => u.role === 'admin').map(([l]) => l)])];
    return { viewers: this.store.get().viewers, admins, candidates: [...new Set([...a.roots, ...Object.keys(a.users)])].sort() };
  }

  // 내가 속한 조직 — 토큰 주인의 조직 + GITHUB_ORGS. 30분 동안 담아 둔다
  private orgsCache: { at: number; list: string[] } | null = null;
  private async myOrgs(): Promise<string[]> {
    if (this.orgsCache && Date.now() - this.orgsCache.at < 30 * 60_000) return this.orgsCache.list;
    const d = await ghGraphql<any>('query { viewer { organizations(first: 100) { nodes { login } } } }', {}).catch(() => null);
    const list = [...new Set([...((d?.viewer?.organizations?.nodes || []) as any[]).map((n) => String(n.login)), ...cfg.orgs])];
    this.orgsCache = { at: Date.now(), list };
    return list;
  }

  /** 저장소 찾기 — 주인 저장소 + 내가 속한 모든 조직. 비우면 최근 수정 순, '조직/저장소' 는 그대로 찾는다 */
  private async reposView(qText: string) {
    const tracked = this.store.get().repos;
    const base = { tracked, types: TYPES, org: cfg.owner };
    try {
      const orgs = await this.myOrgs();
      const direct = directRepo(qText);
      const text = cleanText(direct ? direct.name : qText);
      // 직접 찾은 저장소가 없으면 그 별칭만 오류다 — 나머지 결과는 쓴다
      const res = await ghFetch('graphql', { method: 'POST', body: JSON.stringify({ query: searchGraphql(searchQueries(text, cfg.owner, orgs), direct) }) }, undefined, 30000);
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j.data) throw new Error(j.errors?.[0]?.message || j.message || `HTTP ${res.status}`);
      const data = j.data;
      const results = collect(data, cfg.owner).map((r) => ({ ...r, tracked: tracked.some((t) => t.repo.toLowerCase() === r.repo.toLowerCase()) }));
      return { ...base, results, orgs };
    } catch (e: any) {
      // 못 찾으면 빈 결과 대신 까닭을 보인다(토큰·한도)
      return { ...base, results: [], error: `GitHub 에서 찾지 못했습니다: ${e?.message || e}` };
    }
  }

  private async reportView() {
    const c = await this.load(false);
    const week = isoWeek();
    const saved = this.store.get().reports[week.key] || {};
    const projects = this.store.get().repos.map(({ repo }) => {
      const name = repo;   // 프로젝트 = 따라가는 저장소 하나
      const cards = c.cards.filter((x) => x.repo === repo);
      const tasks = cards.filter((x) => x.stage !== 'done' || (x.closedAt && Date.parse(x.closedAt) >= week.start)).map((x) => ({
        repo: x.repo, number: x.number, title: x.title, stage: x.stage, prevStage: x.prevStage, assignees: x.assignees,
        overdue: x.overdue, stale: x.stale, flags: x.flags, url: x.url,
      }));
      const auto = draftReport(cards, week.start);
      const r = saved[name];
      const text = r?.text ?? auto;
      const status = r?.reflectedAt ? (text === r.reflectedText ? 'reflected' : 'changed') : r ? 'edited' : 'auto';
      const warnings = tasks.filter((t) => t.flags.includes('blocked')).map((t) => `#${t.number} 막힘`);
      return {
        name, repos: [repo], milestone: '', tasks, auto, text, edited: !!r, editedBy: r?.by ?? null, editedAt: r?.at ?? null,
        reflectedAt: r?.reflectedAt ?? null, reflectedBy: r?.reflectedBy ?? null, sheetText: r?.reflectedText ?? '', warnings, status,
      };
    });
    return { ok: true, week: week.key, weekFound: true, legacyRemoved: 0, projects };
  }

  // ── 쓰기 ──
  private target(b: any) {
    const repo = String(b?.repo || ''), number = Number(b?.number);
    if (!REPO_RE.test(repo) || !Number.isInteger(number) || number < 1) throw new HttpError(400, '저장소·이슈 번호가 올바르지 않습니다');
    if (!this.store.get().repos.some((t) => t.repo === repo)) throw new HttpError(400, '따라가는 저장소가 아닙니다');
    return { repo, number };
  }
  private needWrite() { if (!cfg.githubWriteToken) throw new HttpError(403, '읽기 전용 보드입니다(GITHUB_WRITE_TOKEN 없음)'); }
  private async gh(path: string, method = 'GET', body?: unknown) {
    const res = await ghFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, cfg.githubWriteToken || cfg.githubToken);
    return res;
  }
  /** 담당자이거나 관리자만 */
  private async issueFor(s: { login: string; admin: boolean }, t: { repo: string; number: number }) {
    const i = await ghJson<any>(`repos/${full(t.repo)}/issues/${t.number}`);
    if (!i) throw new HttpError(404, '이슈를 찾지 못했습니다');
    const mine = (i.assignees || []).some((a: any) => String(a.login).toLowerCase() === s.login.toLowerCase());
    if (!s.admin && !mine) throw new HttpError(403, '담당자만 옮길 수 있습니다');
    return i;
  }
  private async ensureLabel(repo: string, name: string, color: string) {
    const r = await this.gh(`repos/${full(repo)}/labels`, 'POST', { name, color, description: '업무보드' });
    if (!r.ok && r.status !== 422) throw new HttpError(502, `라벨을 만들지 못했습니다(HTTP ${r.status})`);
  }
  private async setLabels(repo: string, number: number, labels: string[]) {
    const r = await this.gh(`repos/${full(repo)}/issues/${number}/labels`, 'PUT', { labels });
    if (!r.ok) throw new HttpError(502, `라벨을 바꾸지 못했습니다(HTTP ${r.status})`);
    this.cache = null;
    return labels;
  }

  private async move(s: { login: string; admin: boolean }, b: any, to: string | null) {
    this.needWrite();
    const t = this.target(b);
    if (to !== null && !(STAGES as readonly string[]).includes(to)) throw new HttpError(400, '단계가 올바르지 않습니다');
    const i = await this.issueFor(s, t);
    const cur = (i.labels || []).map((l: any) => String(l.name));
    if (to) await this.ensureLabel(t.repo, STAGE_LABEL(to as Stage), STAGE_COLOR[to as Stage]);
    const labels = await this.setLabels(t.repo, t.number, stageLabels(cur, to as Stage | null));
    await audit({ login: s.login, action: to ? 'board.move' : 'board.follow', target: `${t.repo}#${t.number}`, detail: to ? STAGE_KO[to as Stage] : '기록 따르기', ok: true });
    return { ok: true, labels };
  }

  private async blocked(s: { login: string; admin: boolean }, b: any) {
    this.needWrite();
    const t = this.target(b);
    const i = await this.issueFor(s, t);
    const cur: string[] = (i.labels || []).map((l: any) => String(l.name));
    const on = !cur.includes(BLOCKED_LABEL);
    if (on) await this.ensureLabel(t.repo, BLOCKED_LABEL, 'd73a4a');
    await this.setLabels(t.repo, t.number, on ? [...cur, BLOCKED_LABEL] : cur.filter((l) => l !== BLOCKED_LABEL));
    await audit({ login: s.login, action: 'board.blocked', target: `${t.repo}#${t.number}`, detail: on ? '막힘' : '막힘 풀림', ok: true });
    return { ok: true, blocked: on };
  }

  private async close(s: { login: string; admin: boolean }, b: any) {
    this.needWrite();
    const t = this.target(b);
    if (b?.state !== 'closed') throw new HttpError(400, '닫기만 할 수 있습니다');
    await this.issueFor(s, t);
    const r = await this.gh(`repos/${full(t.repo)}/issues/${t.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    if (!r.ok) throw new HttpError(502, `이슈를 닫지 못했습니다(HTTP ${r.status})`);
    this.cache = null;
    await audit({ login: s.login, action: 'board.close', target: `${t.repo}#${t.number}`, ok: true });
    return { ok: true };
  }

  private async changeViewer(s: { login: string; admin: boolean }, b: any) {
    if (!s.admin) throw new HttpError(403, '관리자만 바꿀 수 있습니다');
    const login = String(b?.login || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,38}$/.test(login)) throw new HttpError(400, '아이디가 올바르지 않습니다');
    const next = this.store.update(undefined, (d) => {
      if (b?.action === 'add' && !d.viewers.includes(login)) d.viewers.push(login);
      if (b?.action === 'remove') d.viewers = d.viewers.filter((v) => v !== login);
      d.viewers.sort();
    });
    await audit({ login: s.login, action: 'board.viewer', target: login, detail: b?.action, ok: true });
    return { ok: true, viewers: next.viewers };
  }

  private async changeRepo(s: { login: string; admin: boolean }, b: any) {
    if (!s.admin) throw new HttpError(403, '관리자만 바꿀 수 있습니다');
    const repo = String(b?.repo || '').trim();
    if (!REPO_RE.test(repo)) throw new HttpError(400, '저장소 이름이 올바르지 않습니다');
    const type = TYPES[b?.type] ? String(b.type) : 'etc';
    this.store.update(undefined, (d) => {
      if (b?.action === 'add' && !d.repos.some((r) => r.repo === repo)) d.repos.push({ repo, type });
      if (b?.action === 'remove') d.repos = d.repos.filter((r) => r.repo !== repo);
      if (b?.action === 'type') d.repos = d.repos.map((r) => (r.repo === repo ? { ...r, type } : r));
    });
    this.cache = null;
    await audit({ login: s.login, action: 'board.repo', target: repo, detail: b?.action, ok: true });
    return { ok: true };
  }

  private async reportAct(s: { login: string; admin: boolean }, b: any) {
    const project = String(b?.project || '');
    if (!isSafeKey(project) || !this.store.get().repos.some((r) => r.repo === project)) throw new HttpError(400, '없는 프로젝트입니다');
    const week = isoWeek().key;
    const now = new Date().toISOString();
    if (b?.action === 'save' || b?.action === 'reflect') {
      const text = String(b?.text ?? '').slice(0, 20000);
      if (!text.trim()) throw new HttpError(400, '내용이 비었습니다');
      this.store.update(undefined, (d) => {
        const wk = (d.reports[week] ||= {});
        const prev = wk[project];
        wk[project] = { ...prev, text, by: s.login, at: now,
          ...(b.action === 'reflect' ? { reflectedAt: now, reflectedBy: s.login, reflectedText: text } : {}) };
      });
    } else if (b?.action === 'reset') {
      this.store.update(undefined, (d) => { if (d.reports[week]) delete d.reports[week][project]; });
    } else throw new HttpError(400, '조치는 save·reset·reflect 입니다');
    await audit({ login: s.login, action: `board.report.${b.action}`, target: `${week} ${project}`, ok: true });
    return { ok: true };
  }
}

function readJson(req: Request): Promise<any> {
  return new Promise((ok) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { d += c; if (d.length > 100_000) req.destroy(); });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } });
    req.on('error', () => ok({}));
  });
}

