import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { cfg, full } from '../core/config.js';
import { ghFetch, ghJson } from '../core/github.js';
import { DEFAULT_INFRA, PLACEMENT } from '../infra/defaults.js';
import { DEFAULT_COMPONENTS } from '../catalog/defaults.js';
import { RelationsService } from '../relations/relations.service.js';
import { LaneKind, STAGES, Step, sliceLog, stageOf, tailLog } from './lanes.js';
import { PipeTarget, Pipeline, deployHostOf, pipelineQuery, toPipeline } from './pipelines.js';

// 전체 도식 + 실시간 배포(B·F). 도식은 카탈로그·인프라·연관 관계로 만들고, 실행 중인 배포는 저장소 Actions 를 짧게 돌며 읽는다.
export interface Track { comp: string; lane: LaneKind; repo: string; workflow: string }
export interface ActiveRun {
  id: number; repo: string; workflow: string; url: string; number: number; title: string; actor: string; event: string; branch: string;
  startedAt: string; endedAt: string | null; state: string;
  comps: string[]; lane: LaneKind; ambiguous: boolean;
  stage: { index: number; current: string | null; done: number; total: number; failedStep: string | null; branch?: 'ota' | 'store' };
  jobs: { id: number; name: string; status: string; conclusion: string | null; steps: Step[] }[];
}

const SLOW_MS = 15000;      // 조용한 저장소
const PIPE_IDLE_MS = 60_000;   // 배포 흐름: 도는 배포가 없을 때 GitHub 을 다시 보는 간격
const PIPE_BUSY_MS = 5_000;    //            도는 배포가 있을 때
const FAST_MS = 3000;       // 실행 중인 저장소
const RECENT_MS = 15 * 60 * 1000;

/** 이 저장소에서 진행 중으로 기억했는데 최근 실행 목록에 없는 실행 id (#171) */
export function lostRunIds(active: Iterable<ActiveRun>, repo: string, listed: Set<number>): number[] {
  const out: number[] = [];
  for (const a of active) if (a.repo === repo && a.state === 'running' && !listed.has(a.id)) out.push(a.id);
  return out;
}

/** 구성요소별 배포 갈래 — 어느 저장소의 어느 워크플로가 어느 갈래인가 */
export function tracksOf(): Track[] {
  const out: Track[] = [];
  for (const c of DEFAULT_COMPONENTS) {
    for (const wf of c.deploy?.testbed?.workflows ?? []) out.push({ comp: c.key, lane: 'testbed', repo: c.repo, workflow: wf });
    for (const wf of c.deploy?.prod?.workflows ?? []) out.push({ comp: c.key, lane: 'prod', repo: c.repo, workflow: wf });
    if (c.kind === 'device-app') out.push({ comp: c.key, lane: 'apk', repo: c.repo, workflow: 'release-apk.yml' });
    if (c.kind === 'store-app' && c.store) out.push({ comp: c.key, lane: 'store', repo: c.repo, workflow: c.store.workflow });
    // 앱 테스트 빌드(#182): dev 머지마다 도는 testbed-apk.yml. 아직 없는 저장소는 실행이 없어 보이지 않는다
    if (c.kind === 'device-app' || (c.kind === 'store-app' && c.store)) out.push({ comp: c.key, lane: 'apptest', repo: c.repo, workflow: 'testbed-apk.yml' });
  }
  return out;
}

@Injectable()
export class FlowService implements OnModuleInit, OnModuleDestroy {
  private readonly tracks = tracksOf();
  private repoState = new Map<string, { at: number; runs: any[] }>();
  private active = new Map<string, ActiveRun>();        // repo#id
  private kamalHint = new Map<string, string[]>();      // 같은 워크플로를 나눠 쓰는 실행 → 로그로 읽은 대상
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly catalog: CatalogService, private readonly rel: RelationsService) {}

  onModuleInit() {
    if (process.env.FLOW_POLL === 'off') return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref?.();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private repos() { return [...new Set(this.tracks.map((t) => t.repo))]; }

  /** 1초마다 — 저장소마다 정해진 간격이 지났으면 최근 실행 5개를 다시 본다 */
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = this.repos().filter((r) => {
        const s = this.repoState.get(r);
        const busy = [...this.active.values()].some((a) => a.repo === r && a.state === 'running');
        return !s || now - s.at >= (busy ? FAST_MS : SLOW_MS);
      }).slice(0, 6);
      await Promise.all(due.map((r) => this.pollRepo(r).catch(() => {})));
      for (const [k, a] of this.active) if (a.state !== 'running' && a.endedAt && now - Date.parse(a.endedAt) > RECENT_MS) this.active.delete(k);
    } finally { this.ticking = false; }
  }

  private async pollRepo(repo: string) {
    const j = await ghJson<any>(`repos/${full(repo)}/actions/runs?per_page=10`);
    const runs: any[] = j?.workflow_runs || [];
    this.repoState.set(repo, { at: Date.now(), runs });
    for (const r of runs) await this.absorb(repo, r);
    // 진행 중으로 기억한 실행이 최근 10개 밖으로 밀리면(옛 실행 재실행, 15분마다 도는 probe) 끝을 못 본다. id 로 직접 묻는다 (#171)
    for (const id of lostRunIds(this.active.values(), repo, new Set<number>(runs.map((r) => r.id)))) {
      const r = await ghJson<any>(`repos/${full(repo)}/actions/runs/${id}`).catch(() => undefined);
      if (r === null) this.active.delete(`${repo}#${id}`);   // GitHub 에서 지워진 실행
      else if (r) await this.absorb(repo, r);
    }
  }

  /** 실행 하나를 active 에 반영한다. 끝난 것은 최근 것만, 그리고 한 번만 다시 읽는다 */
  private async absorb(repo: string, r: any) {
    const wf = String(r.path || '').split('@')[0];
    const tracks = this.tracks.filter((t) => t.repo === repo && t.workflow === wf);
    if (!tracks.length) return;
    const k = `${repo}#${r.id}`;
    const running = r.status !== 'completed';
    const ended = r.completed_at || null;
    if (!running && (!ended || Date.now() - Date.parse(ended) > RECENT_MS) && !this.active.has(k)) return;
    if (!running && this.active.get(k)?.state !== 'running' && this.active.has(k)) return;   // 끝난 것은 한 번만 다시 읽는다
    const jobs: any[] = (await ghJson<any>(`repos/${full(repo)}/actions/runs/${r.id}/jobs`))?.jobs || [];
    const steps: Step[] = jobs.flatMap((x) => x.steps || []);
    const lane = tracks[0].lane;
    let comps = [...new Set(tracks.map((t) => t.comp))];
    const ambiguous = comps.length > 1;
    if (ambiguous) comps = (await this.narrow(repo, k, jobs, comps)) ?? comps;
    this.active.set(k, {
      id: r.id, repo, workflow: wf, url: r.html_url, number: r.run_number, title: String(r.display_title || '').split('\n')[0].slice(0, 140),
      actor: r.triggering_actor?.login || r.actor?.login || '', event: r.event, branch: r.head_branch || '',
      startedAt: r.run_started_at || r.created_at || '', endedAt: ended, state: running ? 'running' : (r.conclusion || 'unknown'),
      comps, lane, ambiguous: ambiguous && comps.length > 1, stage: stageOf(lane, steps),
      jobs: jobs.map((x) => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion ?? null, steps: x.steps || [] })),
    });
  }

  /** sso 처럼 한 저장소가 여러 대상을 같은 워크플로로 배포하면, 로그의 Kamal 컨테이너 이름으로 대상을 가린다 */
  private async narrow(repo: string, key: string, jobs: any[], comps: string[]) {
    const hit = this.kamalHint.get(key);
    if (hit) return hit;
    const byKamal = new Map<string, string>();
    for (const c of DEFAULT_COMPONENTS) if (comps.includes(c.key)) for (const t of [c.deploy?.testbed, c.deploy?.prod]) if (t) byKamal.set(t.kamal, c.key);
    for (const job of jobs) {
      if (!job.runner_name && job.status === 'waiting') continue;
      const res = await ghFetch(`repos/${full(repo)}/actions/jobs/${job.id}/logs`).catch(() => null);
      if (!res?.ok) continue;
      const log = await res.text();
      const found = [...byKamal.entries()].filter(([k]) => new RegExp(`${k}-web-`).test(log)).map(([, c]) => c);
      const target = log.match(/\btarget:\s*(app|admin|webview)\b/)?.[1];
      const pick = found.length ? found : target ? comps.filter((c) => (target === 'app' ? c === 'sso' : c === target)) : [];
      if (pick.length) { this.kamalHint.set(key, pick); return pick; }
    }
    return null;
  }

  live() {
    return { at: new Date().toISOString(), runs: [...this.active.values()].sort((a, b) => b.id - a.id) };
  }

  private tails = new Map<string, { at: number; data: any }>();
  /** 진행 중 작업의 로그 끝 — 도식의 노드 옆 카드(3초마다) */
  async tail(repo: string, runId: number) {
    if (!this.repos().includes(repo)) throw new NotFoundException();
    const k = `${repo}#${runId}`;
    const hit = this.tails.get(k);
    if (hit && Date.now() - hit.at < 2500) return hit.data;
    const jobs: any[] = (await ghJson<any>(`repos/${full(repo)}/actions/runs/${runId}/jobs`))?.jobs || [];
    // 재사용 워크플로를 부르는 쪽 작업은 러너가 없고 로그도 없다 — 러너에서 실제로 도는 작업을 고른다
    const real = jobs.filter((j) => j.runner_name);
    const job = real.find((j) => j.status === 'in_progress' || j.status === 'running') ?? real[real.length - 1] ?? jobs[jobs.length - 1];
    let lines: string[] = [];
    if (job) {
      const res = await ghFetch(`repos/${full(repo)}/actions/jobs/${job.id}/logs`).catch(() => null);
      if (res?.ok) lines = tailLog(await res.text(), 12);
    }
    const step = (job?.steps || []).find((s: any) => s.status === 'in_progress' || s.status === 'running');
    const data = { job: job?.name ?? null, step: step?.name ?? null, stepStarted: step?.started_at ?? null, lines };
    this.tails.set(k, { at: Date.now(), data });
    return data;
  }

  /** 실패(또는 지정) 단계 로그 — 단계 시각으로 잘라서 */
  async stepLog(repo: string, runId: number, stepName?: string) {
    if (!this.repos().includes(repo)) throw new NotFoundException();
    const jobs: any[] = (await ghJson<any>(`repos/${full(repo)}/actions/runs/${runId}/jobs`))?.jobs || [];
    for (const job of jobs) {
      const step = (job.steps || []).find((s: any) => (stepName ? s.name === stepName : s.conclusion === 'failure'));
      if (!step) continue;
      const res = await ghFetch(`repos/${full(repo)}/actions/jobs/${job.id}/logs`);
      if (!res.ok) continue;
      return { job: job.name, step: step.name, log: sliceLog(await res.text(), step.started_at, step.completed_at) };
    }
    return { job: null, step: null, log: '' };
  }

  // ── 배포 흐름(서비스별 파이프라인) ──
  private pipe: { at: number; pipelines: Pipeline[]; error?: string } | null = null;
  private pipeLoading: Promise<void> | null = null;

  /** GitHub Deployments 환경이 있는 구성요소 — 카탈로그에서 지운 것은 뺀다 */
  pipeTargets(): PipeTarget[] {
    const view = new Map(this.catalog.view().components.map((c) => [c.key, c]));
    return DEFAULT_COMPONENTS.flatMap((c) => {
      const env = c.deploy?.prod?.environment;
      const v = view.get(c.key);
      if (!env || !v) return [];
      const repo = full(c.repo); const [owner, repoName] = repo.split('/');
      return [{ key: c.key, name: v.name, repo, owner, repoName, environment: env, site: c.prod?.link, logo: v.logo ?? null }];
    });
  }

  /** 화면은 몇 초마다 부르고, GitHub 은 60초(도는 배포가 있으면 5초)에 한 번 GraphQL 한 번으로 본다 */
  async pipelines(force = false) {
    const busy = !!this.pipe?.pipelines.some((p) => p.active);
    const age = this.pipe ? Date.now() - this.pipe.at : Infinity;
    const stale = age >= (busy ? PIPE_BUSY_MS : PIPE_IDLE_MS) || (force && age >= PIPE_BUSY_MS);
    if (stale) {
      this.pipeLoading ??= this.loadPipelines().finally(() => { this.pipeLoading = null; });
      await this.pipeLoading;
    }
    const p = this.pipe!;
    return { at: new Date(p.at).toISOString(), pipelines: p.pipelines, error: p.error };
  }

  private async loadPipelines() {
    const targets = this.pipeTargets();
    if (!targets.length) { this.pipe = { at: Date.now(), pipelines: [] }; return; }
    try {
      // ghGraphql 은 오류가 하나라도 있으면 던진다 — 저장소 하나가 없어져도 나머지는 보이게 직접 부른다
      const res = await ghFetch('graphql', { method: 'POST', body: JSON.stringify({ query: pipelineQuery(targets) }) }, undefined, 30000);
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j.data) throw new Error(j.errors?.[0]?.message || j.message || `HTTP ${res.status}`);
      this.pipe = { at: Date.now(), pipelines: targets.map((t, i) => toPipeline(t, j.data[`r${i}`])) };
    } catch (e: any) {
      // 못 읽으면 지난 값을 그대로 두고 오류만 알린다(처음이면 빈 목록)
      this.pipe = { at: Date.now(), pipelines: this.pipe?.pipelines ?? [], error: `GitHub 을 읽지 못했습니다: ${e?.message || e}` };
    }
  }

  /** 전체 도식 — 노드(프로젝트·구성요소·인프라·가상 단계)와 선(배포 갈래·연관 관계) */
  graph() {
    const cat = this.catalog.view();
    const g = this.rel.graph();
    const comps = cat.components.filter((c) => c.project !== '_unassigned');
    const infra = new Map(g.nodes.map((n) => [n.id, n]));
    // 가상 노드 — 부모앱 판정·사람 출시·사용자, APK 보관함
    const virtual = [
      { id: 'v:decide', kind: 'decide', name: 'OTA, 스토어 판정', sub: 'JS 만 바뀌면 OTA, 네이티브가 바뀌면 스토어' },
      { id: 'v:human-release', kind: 'human', name: '사람: 스토어 "출시"', sub: 'TestFlight, Play 내부 테스트 → 심사, 출시' },
      { id: 'v:users', kind: 'device', name: '사용자 폰', sub: '스토어 업데이트, OTA 는 다음 실행 때' },
      { id: 'v:apk-box', kind: 'device', name: '기기 설치', sub: '콘솔 APK 보관함(/apk) → adb, 직접 설치' },
      { id: 'v:testers', kind: 'device', name: '테스트 기기', sub: '콘솔 APK 보관함 내부 테스트, TestFlight 내부 테스터 (개발 서버 연동)' },
    ];
    const lanes: { id: string; comp: string; lane: LaneKind; path: string[] }[] = [];
    for (const c of comps) {
      const p = PLACEMENT[c.key];
      if (!p) continue;
      const from = `comp:${c.key}`;
      if (c.kind === 'backend' || c.kind === 'web') {
        if (p.testbed && c.deployable.testbed) lanes.push({ id: `${c.key}:testbed`, comp: c.key, lane: 'testbed', path: [from, 'infra:github', `infra:${p.runner}`, `infra:${p.artifact}`, `infra:${p.testbed}`] });
        if (p.prod && c.deployable.prod) lanes.push({ id: `${c.key}:prod`, comp: c.key, lane: 'prod', path: [from, 'infra:github', `infra:${p.runner}`, `infra:${p.artifact}`, `infra:${p.prod}`] });
      } else if (c.kind === 'device-app') {
        lanes.push({ id: `${c.key}:apk`, comp: c.key, lane: 'apk', path: [from, 'infra:github', `infra:${p.runner}`, 'infra:apk-release', 'v:apk-box'] });
        // 테스트 빌드(#182): 같은 러너에서 개발 서버 연동 APK 를 빌드해 GitHub 프리릴리스(보관함 내부 테스트)로
        lanes.push({ id: `${c.key}:apptest`, comp: c.key, lane: 'apptest', path: [from, 'infra:github', `infra:${p.runner}`, 'infra:apk-release', 'v:testers'] });
      } else if (c.kind === 'store-app') {
        lanes.push({ id: `${c.key}:store`, comp: c.key, lane: 'store', path: [from, 'infra:github', `infra:${p.runner}`, 'v:decide', 'infra:ota|infra:stores', 'v:human-release|v:users', 'v:users'] });
        // 테스트 빌드(#182): APK 는 GitHub 프리릴리스(보관함 내부 테스트), iOS 는 TestFlight 내부 테스터
        if (c.store) lanes.push({ id: `${c.key}:apptest`, comp: c.key, lane: 'apptest', path: [from, 'infra:github', `infra:${p.runner}`, 'infra:apk-release|infra:stores', 'v:testers'] });
      }
    }
    const relations = this.rel.liveEdges().filter((e) => e.from.startsWith('comp:'))
      .map((e) => ({ id: e.id, from: e.from, to: e.to, via: e.via, state: e.state as string }));
    // 배포 대상 — GitHub Deployments 환경이 있는 구성요소 → GitHub Pages·Vercel 등(구성도에서 어디에 올라가 있는지)
    for (const t of this.pipeTargets()) {
      const h = deployHostOf(t.site, t.environment);
      if (!virtual.some((v) => v.id === h.id)) virtual.push({ id: h.id, kind: 'server', name: h.name, sub: h.sub });
      relations.push({ id: `deploy:${t.key}`, from: `comp:${t.key}`, to: h.id, via: `배포 · ${t.environment}`, state: 'deploy' });
    }
    return {
      projects: cat.roots, components: comps,
      infra: [...infra.values()], virtual,
      lanes, relations,
      stages: Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.map((s) => ({ id: s.id, label: s.label }))])),
      infraDefs: DEFAULT_INFRA.map((i) => i.id),
    };
  }
}
