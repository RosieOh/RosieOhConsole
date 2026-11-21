import { readDoc, writeDoc } from '../persist.js';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { cfg, full } from '../config.js';
import { ghFetch, ghJson, ownerRepos } from '../github.js';
import { normName, placeOf, retired, RunnerPlace } from './known.js';
import { History, JobLite, queueOf, record, RunnerStats, statsFor, toJob, uptime } from './stats.js';
import { parseWorkflow, resolveLabel, runnerMatches, TemplateRef, WfFile } from './workflows.js';

// 러너 화면(콘솔 개편 C) — 러너 목록·사용처·작업 집계·가동률
export interface Usage {
  repo: string; file: string; workflow: string; job: string; labels: string[]; via: string | null;   // via = 따라간 공용 템플릿
  triggers: string[]; components: { key: string; name: string; logo: string | null }[];
}
export interface RunnerView extends RunnerPlace {
  id: number; name: string; status: 'online' | 'offline'; busy: boolean; disabled: boolean; labels: string[];
  uses: Usage[]; stats: RunnerStats; uptime: { ratio: number; since: string } | null;
  spof: string[];          // 이 러너만 받을 수 있는 작업의 서비스(구성요소 이름)
  alerts: string[];
}
export interface RunnersView {
  source: 'repo'; runners: RunnerView[]; orphans: Usage[];   // 받을 러너가 없는 작업
  queue: { count: number; oldestSec: number | null; jobs: JobLite[] };
  alerts: { level: 'red' | 'amber'; text: string }[];
  scannedAt: string | null; updatedAt: string; error?: string;
}

const RUNNERS_TTL = 30 * 1000;
const SCAN_TTL = 10 * 60 * 1000;
const JOB_REPOS = 10;        // 작업을 읽을 저장소 수(최근 push 순)
const RUNS_PER_REPO = 5;
// GitHub 호스티드 러너 라벨 — 목록에 안 나오지만 GitHub 이 받아 준다(받을 러너 없음 경고에서 뺀다)
const HOSTED = /^(ubuntu|windows|macos)-/i;
const hosted = (labels: string[]) => labels.length > 0 && labels.every((l) => HOSTED.test(l));
const POLL_MS = 60 * 1000;
const QUEUE_WARN_SEC = 10 * 60;

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

@Injectable()
export class RunnersService implements OnModuleInit, OnModuleDestroy {
  private snap: { at: number; data: RunnersView } | null = null;
  private inflight: Promise<RunnersView> | null = null;
  private scan: { at: number; uses: Omit<Usage, 'components'>[] } | null = null;
  private scanning: Promise<Omit<Usage, 'components'>[]> | null = null;
  private history: History = {};
  private historyLoaded = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly catalog: CatalogService) {}

  onModuleInit() {
    if (process.env.RUNNERS_POLL === 'off') return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
    setTimeout(() => void this.poll(), 5000).unref?.();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async loadHistory() {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    try { this.history = readDoc('runner-history') ?? {}; } catch { this.history = {}; }
  }
  private async saveHistory() {
    try { writeDoc('runner-history', this.history); }
    catch (e: any) { console.warn('[러너] 가동 기록을 쓰지 못했다:', e?.message); }
  }

  /** 1분마다 상태만 보고 바뀐 순간을 남긴다 */
  private async poll() {
    try {
      await this.loadHistory();
      const { list } = await this.runnerList();
      let changed = false;
      for (const r of list) changed = record(this.history, normName(r.name), r.status === 'online') || changed;
      if (changed) await this.saveHistory();
    } catch (e: any) { console.warn('[러너] 상태 확인 실패:', e?.message); }
  }

  /** 살아 있는 내 저장소(보관·포크 제외), 최근 push 순 */
  private async liveRepos() {
    return (await ownerRepos()).filter((r) => !r.archived && !r.fork)
      .sort((a, b) => String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')));
  }

  // 셀프 호스티드 러너 — GitHub 사용자 계정엔 계정 단위 러너가 없어 저장소마다 읽는다(토큰에 Administration read 가 있어야 보인다)
  private async runnerList(): Promise<{ source: 'repo'; list: any[] }> {
    const repos = await this.liveRepos();
    const lists = await pool(repos, 6, (r: any) => ghJson<any>(`repos/${full(r.name)}/actions/runners?per_page=100`).catch(() => null));
    const byId = new Map<number, any>();
    for (const j of lists) for (const r of j?.runners || []) byId.set(r.id, r);
    return { source: 'repo', list: [...byId.values()] };
  }

  private async raw(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const res = await ghFetch(`repos/${owner}/${repo}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.raw' } });
    return res.ok ? res.text() : null;
  }

  // ── 사용처 — 내 저장소의 워크플로를 읽어 runs-on 을 모은다(10분 캐시) ──
  private async scanUses(force: boolean) {
    if (!force && this.scan && Date.now() - this.scan.at < SCAN_TTL) return this.scan.uses;
    this.scanning ??= this.doScan().then((uses) => { this.scan = { at: Date.now(), uses }; return uses; }).finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private async doScan() {
    const repos = await this.liveRepos();
    const tplCache = new Map<string, Promise<WfFile | null>>();
    const template = (t: TemplateRef) => {
      const k = `${t.owner}/${t.repo}/${t.path}@${t.ref}`;
      if (!tplCache.has(k)) tplCache.set(k, this.raw(t.owner, t.repo, t.path, t.ref).then((s) => (s ? parseWorkflow(s) : null)).catch(() => null));
      return tplCache.get(k)!;
    };
    const per = await pool(repos, 6, async (r: any) => {
      const out: Omit<Usage, 'components'>[] = [];
      const ref = r.default_branch || 'main';
      const dir = await ghJson<any[]>(`repos/${full(r.name)}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`).catch(() => null);
      for (const f of Array.isArray(dir) ? dir : []) {
        if (f.type !== 'file' || !/\.ya?ml$/.test(f.name)) continue;
        const [o, n] = full(r.name).split('/');
        const text = await this.raw(o, n, f.path, ref).catch(() => null);
        if (!text) continue;
        const wf = parseWorkflow(text);
        for (const j of wf.jobs) {
          const base = { repo: r.name, file: f.name, workflow: wf.name || f.name, triggers: wf.triggers };
          if (j.uses) {
            const tpl = await template(j.uses);
            const via = `${j.uses.repo}/${j.uses.path.split('/').pop()}`;
            if (!tpl) { out.push({ ...base, job: j.name, labels: [], via }); continue; }
            const inputs = { ...tpl.inputDefaults, ...j.with };
            for (const tj of tpl.jobs) {
              if (!tj.runsOn) continue;
              const labels = tj.runsOn.map((l) => resolveLabel(l, inputs)).filter((l): l is string => !!l);
              out.push({ ...base, job: `${j.name} › ${tj.name}`, labels, via });
            }
          } else if (j.runsOn) {
            const labels = j.runsOn.map((l) => resolveLabel(l, {})).filter((l): l is string => !!l);
            out.push({ ...base, job: j.name, labels, via: null });
          }
        }
      }
      return out;
    });
    return per.flat();
  }

  // ── 작업 — 최근 push 한 저장소들의 최근 실행 → 그 작업들(GitHub 엔 계정 전체 작업 목록이 없다) ──
  private async recentJobs(): Promise<JobLite[]> {
    const repos = (await this.liveRepos()).slice(0, JOB_REPOS);
    const runs = (await pool(repos, 6, async (r: any) => ((await ghJson<any>(`repos/${full(r.name)}/actions/runs?per_page=${RUNS_PER_REPO}`).catch(() => null))?.workflow_runs || []).map((x: any) => ({ repo: r.name, id: x.id })))).flat();
    const lists = await pool(runs, 6, (x: { repo: string; id: number }) => ghJson<any>(`repos/${full(x.repo)}/actions/runs/${x.id}/jobs?per_page=50`).catch(() => null));
    const m = new Map<number, JobLite>();
    for (const l of lists) for (const j of l?.jobs || []) m.set(j.id, toJob(j));
    return [...m.values()];
  }

  async view(force = false): Promise<RunnersView> {
    if (!force && this.snap && Date.now() - this.snap.at < RUNNERS_TTL) return this.snap.data;
    this.inflight ??= this.build(force).then((data) => { this.snap = { at: Date.now(), data }; return data; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async build(force: boolean): Promise<RunnersView> {
    await this.loadHistory();
    try {
      const [{ source, list }, rawUses, jobs] = await Promise.all([this.runnerList(), this.scanUses(force).catch(() => this.scan?.uses ?? []), this.recentJobs().catch(() => [] as JobLite[])]);
      const comps = this.catalog.view().components;
      const withComps = (u: Omit<Usage, 'components'>): Usage => ({
        ...u, components: comps.filter((c) => c.repo === u.repo).map((c) => ({ key: c.key, name: c.name, logo: c.logo })),
      });
      const uses = rawUses.map(withComps);
      const runners: RunnerView[] = list.filter((r: any) => !retired(String(r.name))).map((r: any) => {
        const labels: string[] = (r.labels || []).map((l: any) => String(l.name ?? l));
        const name = String(r.name);
        const u = uptime(this.history[normName(name)]);
        return {
          ...placeOf(name), id: r.id, name, status: r.status === 'offline' ? 'offline' : 'online', busy: !!r.busy, disabled: !!r.disabled, labels,
          uses: uses.filter((x) => runnerMatches(labels, x.labels)),
          stats: statsFor(name, jobs, Date.now(), normName),
          uptime: u ? { ratio: u.ratio, since: new Date(u.since).toISOString() } : null,
          spof: [], alerts: [],
        };
      });
      const orphans = uses.filter((x) => x.labels.length && !hosted(x.labels) && !runners.some((r) => runnerMatches(r.labels, x.labels)));
      const alerts: RunnersView['alerts'] = [];
      const svcNames = (us: Usage[]) => [...new Set(us.flatMap((x) => (x.components.length ? x.components.map((c) => c.name) : [x.repo])))];
      for (const r of runners) {
        // 이 러너만 받을 수 있는 작업 — 꺼지면 대신 받을 러너가 없다
        const only = r.uses.filter((x) => runners.filter((o) => !o.disabled && runnerMatches(o.labels, x.labels)).length === 1);
        r.spof = svcNames(only);
        const live = r.uses.length > 0;
        if ((r.status === 'offline' || r.disabled) && live) {
          const who = svcNames(r.uses);
          const hit = r.uses.filter((x) => !runners.some((o) => o !== r && o.status === 'online' && !o.disabled && runnerMatches(o.labels, x.labels)));
          const stuck = svcNames(hit);
          r.alerts.push(stuck.length ? `꺼져 있어 ${stuck.join(', ')} 작업을 받을 러너가 없습니다` : `꺼져 있음, 다른 러너가 대신 받습니다(${who.join(', ')})`);
          alerts.push({ level: stuck.length ? 'red' : 'amber', text: `러너 ${r.name} ${r.alerts[0]}` });
        }
        if (r.stats.failure24h >= 3 && r.stats.failure24h / Math.max(1, r.stats.count24h) >= 0.5)
          r.alerts.push(`최근 24시간 작업 ${r.stats.count24h}개 중 ${r.stats.failure24h}개 실패`);
      }
      const queue = queueOf(jobs);
      if (queue.count && (queue.oldestSec ?? 0) >= QUEUE_WARN_SEC)
        alerts.push({ level: 'amber', text: `러너를 기다리는 작업 ${queue.count}개, 가장 오래 ${Math.round((queue.oldestSec ?? 0) / 60)}분` });
      if (orphans.length) alerts.push({ level: 'amber', text: `받을 러너가 없는 작업 ${orphans.length}개(라벨 ${[...new Set(orphans.map((o) => o.labels.join('+')))].join(', ')})` });
      runners.sort((a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name));
      return { source, runners, orphans, queue, alerts, scannedAt: this.scan ? new Date(this.scan.at).toISOString() : null, updatedAt: new Date().toISOString() };
    } catch (e: any) {
      console.warn('[러너] 읽기 실패:', e?.message);
      if (this.snap) return { ...this.snap.data, error: '갱신 실패, 마지막 값입니다' };
      return { source: 'repo', runners: [], orphans: [], queue: { count: 0, oldestSec: null, jobs: [] }, alerts: [], scannedAt: null, updatedAt: new Date().toISOString(), error: 'GitHub 에서 러너를 읽지 못했다' };
    }
  }
}
