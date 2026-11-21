import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { audit } from '../audit.js';
import { cfg, repoUrl } from '../config.js';
import { DeployTrack, ServiceDef } from '../registry.js';
import { EnvKey, StatusService } from '../status.service.js';
import { RunReading, VERSION_RE, fillInputs, readKamalJobs } from './kamal-log.js';
import { Floor, blockedBy, firstRunOf } from './floor.js';
import { openFailure } from './failures.js';
import { isReleaseTitle, previousVersion } from './versions.js';
import { Change, summarize } from '../apks/changes.js';
import { ghFetch, ghJson } from '../github.js';
import { JsonStore } from '../json-store.js';

export interface DeployRun {
  id: number; number: number; url: string; workflow: string; branch: string; sha: string; event: string; actor: string;
  at: string; ended?: string | null; state: 'running' | 'success' | 'failure' | 'cancelled' | 'skipped' | string;
  action?: 'deploy' | 'rollback'; version?: string | null;
  warn?: string;                  // 배포는 됐지만 같은 실행의 다른 작업(테스트 등)이 실패
}
export interface TrackView {
  env: EnvKey; kamal: string; dest: string;
  current: DeployRun | null;      // 마지막으로 성공한 배포·되돌리기 — "지금 떠 있는 것"으로 본다
  last: DeployRun | null;         // 마지막 시도(실패 포함)
  running: DeployRun[];
  history: DeployRun[];
  all?: DeployRun[];               // 이력 화면용(목록 응답에는 싣지 않는다)
  candidates: string[];           // 되돌릴 수 있는 버전(서버에 남은 최근 것)
  floor: Floor | null;            // 되돌리기 하한(관리자가 정함)
  blocked: Record<string, string>; // 하한보다 먼저 배포돼 막힌 후보 → 이유
  rollback: { workflow: string; confirm?: string } | null;
}
export interface ServiceDeploy { key: string; name: string; repo: string; repoUrl: string; tracks: Partial<Record<EnvKey, TrackView>> }

const RUNS_TTL_MS = 30 * 1000;
const RUNS_PER_WORKFLOW = 30;
const KEEP_VERSIONS = 4;          // Kamal 은 컨테이너 5개(지금 것 + 4)를 남긴다
const ENVS: EnvKey[] = ['testbed', 'prod'];

@Injectable()
export class DeployService {
  private readonly registry: ServiceDef[];
  private runs = new Map<string, { at: number; list: any[] }>();
  private readings = new Map<string, RunReading>();
  private loaded = false;
  private saveTimer?: NodeJS.Timeout;
  private inflight: Promise<any> | null = null;
  private snapshot: { at: number; data: any } | null = null;
  readonly allRuns = new Map<string, DeployRun[]>();   // 구성요소:환경 → 실행 전부(최근 워크플로당 30개)
  private readonly floors = new JsonStore<{ rev: number; floors: Record<string, Floor> }>(`${cfg.dataDir}/rollback-floors.json`, () => ({ rev: 0, floors: {} }));

  constructor(private readonly status: StatusService) {
    this.registry = status.registryInfo();
  }

  private api(path: string, init: RequestInit = {}, token = cfg.githubToken): Promise<Response> { return ghFetch(path, init, token); }
  private json(path: string): Promise<any> { return ghJson(path); }

  // ── 실행 기록 읽기(완료된 실행은 바뀌지 않으므로 결과를 파일에 남겨 다시 읽지 않는다) ──
  private get cacheFile() { return `${cfg.dataDir}/deploy-readings.json`; }
  private async loadCache() {
    if (this.loaded) return;
    this.loaded = true;
    try { for (const [k, v] of Object.entries(JSON.parse(await readFile(this.cacheFile, 'utf8')))) this.readings.set(k, v as RunReading); }
    catch { /* 처음이거나 깨졌다 — 다시 읽으면 된다 */ }
  }
  private saveCache() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await mkdir(cfg.dataDir, { recursive: true });
        await writeFile(this.cacheFile + '.tmp', JSON.stringify(Object.fromEntries(this.readings)), 'utf8');
        await rename(this.cacheFile + '.tmp', this.cacheFile);
      } catch (e: any) { console.warn('[배포] 기록 캐시를 쓰지 못했다:', e?.message); }
    }, 2000);
  }

  private async runsOf(repo: string, wf: string, force: boolean): Promise<any[]> {
    const k = `${repo}/${wf}`;
    const hit = this.runs.get(k);
    if (!force && hit && Date.now() - hit.at < RUNS_TTL_MS) return hit.list;
    const j = await this.json(`repos/${cfg.owner}/${repo}/actions/workflows/${encodeURIComponent(wf)}/runs?per_page=${RUNS_PER_WORKFLOW}`);
    const list = (j?.workflow_runs || []).map((r: any) => ({ ...r, _wf: wf }));
    this.runs.set(k, { at: Date.now(), list });
    return list;
  }

  private async reading(repo: string, run: any): Promise<RunReading | null> {
    if (run.status !== 'completed') return null;
    const k = `${repo}#${run.id}`;
    const hit = this.readings.get(k);
    if (hit) return hit;
    const jobs: any[] = (await this.json(`repos/${cfg.owner}/${repo}/actions/runs/${run.id}/jobs`))?.jobs || [];
    const logs: { log: string; ok: boolean }[] = [];
    for (const job of jobs) {
      const res = await this.api(`repos/${cfg.owner}/${repo}/actions/jobs/${job.id}/logs`);
      if (res.ok) logs.push({ log: await res.text(), ok: job.conclusion === 'success' });   // 재사용 워크플로를 부르는 쪽 작업은 로그가 없다(404)
    }
    const r = readKamalJobs(logs, run._wf);
    this.readings.set(k, r);
    this.saveCache();
    return r;
  }

  private toRun(r: any): DeployRun {
    return {
      id: r.id, number: r.run_number, url: r.html_url, workflow: r._wf, branch: String(r.head_branch || ''), sha: String(r.head_sha || '').slice(0, 12),
      event: r.event, actor: r.triggering_actor?.login || r.actor?.login || '', at: r.run_started_at || r.created_at || '', ended: r.status === 'completed' ? (r.updated_at || null) : null,
      state: r.status === 'completed' ? (r.conclusion || 'unknown') : 'running',
    };
  }

  /** 같은 저장소의 다른 대상과 같이 쓰는 워크플로인가(sso 의 kamal-prod·rollback-dev 처럼) */
  private shared(repo: string, wf: string) {
    let n = 0;
    for (const s of this.registry) if (s.repo === repo) for (const e of ENVS) if (s.deploy?.[e]?.workflows.includes(wf)) n++;
    return n > 1;
  }

  private async track(s: ServiceDef, env: EnvKey, t: DeployTrack, force: boolean): Promise<TrackView> {
    const all = (await Promise.all(t.workflows.map((wf) => this.runsOf(s.repo, wf, force)))).flat().sort((a, b) => b.id - a.id);
    const running: DeployRun[] = [];
    const entries: DeployRun[] = [];
    for (const r of all) {
      const run = this.toRun(r);
      if (run.state === 'running') { running.push(run); continue; }
      const rd = await this.reading(s.repo, r).catch((e) => { console.warn(`[배포] ${s.repo}#${r.id} 로그 읽기 실패:`, e?.message); return null; });
      const hit = rd?.targets.find((x) => x.kamal === t.kamal && x.dest === t.dest);
      if (hit) {
        const state = hit.ok === false ? 'failure' : 'success';
        entries.push({ ...run, state, action: rd!.action, version: hit.version,
          ...(state === 'success' && run.state !== 'success' ? { warn: '배포는 됐지만 같은 실행의 다른 작업(테스트 등)이 실패' } : {}) });
      }
      else if (run.state === 'failure' && !this.shared(s.repo, r._wf)) entries.push({ ...run, action: /^rollback/.test(r._wf) ? 'rollback' : 'deploy', version: null });
    }
    const current = entries.find((e) => e.state === 'success') ?? null;
    const candidates: string[] = [];
    for (const e of entries) {
      if (e.state !== 'success' || !e.version || e.version === current?.version || candidates.includes(e.version)) continue;
      if (candidates.length < KEEP_VERSIONS) candidates.push(e.version);
    }
    const floor = this.floors.get().floors[`${s.key}:${env}`] ?? null;
    return {
      env, kamal: t.kamal, dest: t.dest, current, last: entries[0] ?? null, running, history: entries.slice(0, 10), all: entries, candidates,
      floor, blocked: blockedBy(entries, candidates, floor),
      rollback: t.rollback ? { workflow: t.rollback.workflow, confirm: t.rollback.confirm } : null,
    };
  }

  private async build(force: boolean) {
    await this.loadCache();
    const services: ServiceDeploy[] = [];
    for (const s of this.registry) {
      if (!s.deploy) continue;
      const tracks: ServiceDeploy['tracks'] = {};
      for (const env of ENVS) {
        const t = s.deploy[env];
        if (!t) continue;
        try { const tv = await this.track(s, env, t, force); this.allRuns.set(`${s.key}:${env}`, tv.all ?? []); delete tv.all; tracks[env] = tv; }
        catch (e: any) { console.warn(`[배포] ${s.key}/${env}:`, e?.message); }
      }
      services.push({ key: s.key, name: s.name, repo: s.repo, repoUrl: `${repoUrl(s.repo)}`, tracks });
    }
    // 셀프 호스티드 러너(저장소마다 — 토큰에 저장소 관리 권한이 있어야 보인다). 호스티드 러너는 목록이 없다
    const repos = [...new Set(services.map((x) => x.repo))];
    const runners = (await Promise.all(repos.map((r) => this.json(`repos/${cfg.owner}/${r}/actions/runners`).catch(() => null))))
      .flatMap((j) => j?.runners || [])
      .map((r: any) => ({ name: r.name, status: r.status, busy: !!r.busy, labels: (r.labels || []).map((l: any) => l.name) }));
    // 손봐야 할 실패 — 서비스·환경마다 마지막 결과가 실패인 것(뒤에 성공하면 빠진다)
    const failures = new Map<string, any>();
    for (const sv of services) for (const env of ENVS) {
      const h = openFailure(sv.tracks[env]?.history || []);
      if (h) failures.set(`${sv.repo}#${h.id}`, { ...h, service: sv.name, key: sv.key, env });
    }
    return { services, runners, failures: [...failures.values()].sort((a, b) => b.id - a.id), canRollback: !!cfg.githubWriteToken, updatedAt: new Date().toISOString() };
  }

  async overview(force = false) {
    if (!force && this.snapshot && Date.now() - this.snapshot.at < RUNS_TTL_MS) return this.snapshot.data;
    if (!this.inflight) {
      this.inflight = this.build(force)
        .then((data) => { this.snapshot = { at: Date.now(), data }; return data; })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** 승격·예약이 쓰는 지금 상태 — 한 구성요소·환경의 트랙을 새로 읽는다 */
  async trackNow(key: string, env: EnvKey) {
    const s = this.registry.find((x) => x.key === key);
    const t = s?.deploy?.[env];
    if (!s || !t) return null;
    const v = await this.track(s, env, t, true);
    this.runs.clear(); this.snapshot = null;
    return v;
  }
  defOf(key: string) { return this.registry.find((x) => x.key === key); }

  // 되돌리기 목록용 — 버전마다 그 버전에서 들어온 변경과, 그 버전으로 되돌리면 빠지는 변경(지금 버전과 비교)
  private readonly between = new Map<string, Change[]>();   // 커밋 범위는 바뀌지 않으므로 계속 둔다
  private async changesBetween(repo: string, from: string, to: string): Promise<Change[] | null> {
    const k = `${repo}:${from}...${to}`;
    const hit = this.between.get(k);
    if (hit) return hit;
    const cmp = await ghJson<any>(`repos/${cfg.owner}/${repo}/compare/${from}...${to}`).catch(() => null);
    if (!cmp) return null;
    const list = summarize((cmp.commits || []).map((c: any) => ({ sha: c.sha, message: c.commit?.message || '' }))).filter((c) => !isReleaseTitle(c.title));
    this.between.set(k, list);
    return list;
  }
  async versionNotes(key: string, env: string) {
    const s = this.registry.find((x) => x.key === key);
    if (!s || !ENVS.includes(env as EnvKey) || !s.deploy?.[env as EnvKey]) throw new BadRequestException('없는 서비스, 환경입니다');
    const view = (await this.overview()).services.find((x: ServiceDeploy) => x.key === key)?.tracks[env as EnvKey];
    if (!view) throw new BadRequestException('배포 기록을 아직 읽지 못했습니다');
    const entries = this.allRuns.get(`${key}:${env}`) ?? [];
    const cur = view.current?.version ?? null;
    const versions = await Promise.all(view.candidates.map(async (v: string) => {
      const prev = previousVersion(entries, v);
      return { version: v, added: prev ? await this.changesBetween(s.repo, prev, v) : null, dropped: cur ? await this.changesBetween(s.repo, v, cur) : null };
    }));
    return { current: cur, versions, issueUrl: `${repoUrl(s.repo)}/issues/` };
  }

  // ── 되돌리기 ── 관리자만(컨트롤러). 서버에 남은 버전만, 운영은 이름을 직접 입력, 실행 중이면 거절
  async rollback(login: string, b: { service?: string; env?: string; version?: string; confirm?: string }) {
    const s = this.registry.find((x) => x.key === b.service);
    const env = b.env as EnvKey;
    const t = s && ENVS.includes(env) ? s.deploy?.[env] : undefined;
    if (!s || !t?.rollback) throw new BadRequestException('되돌리기를 할 수 없는 서비스, 환경입니다');
    if (!cfg.githubWriteToken) throw new ServiceUnavailableException('콘솔에 쓰기 토큰(GITHUB_WRITE_TOKEN)이 없습니다');
    const version = String(b.version || '');
    if (!VERSION_RE.test(version)) throw new BadRequestException('버전은 커밋 12자입니다');
    if (t.rollback.confirm && b.confirm !== t.rollback.confirm) throw new BadRequestException(`확인 이름이 다릅니다, "${t.rollback.confirm}" 를 그대로 입력하세요`);

    const view = await this.track(s, env, t, true);
    if (view.running.length) throw new ConflictException('이 서비스의 배포, 되돌리기가 이미 실행 중입니다, 끝난 뒤 다시 하세요');
    if (!view.candidates.includes(version)) throw new BadRequestException('서버에 남아 있는 최근 버전이 아닙니다, 목록에서 고르세요');
    if (view.blocked[version]) throw new BadRequestException(`되돌리기 하한(${view.floor!.version})보다 먼저 배포된 버전입니다, ${view.blocked[version]}`);

    const target = `${s.repo} ${env}(${t.kamal})`;
    const inputs = fillInputs(t.rollback.inputs, { version, confirm: b.confirm || '' });
    const res = await this.api(`repos/${cfg.owner}/${s.repo}/actions/workflows/${encodeURIComponent(t.rollback.workflow)}/dispatches`,
      { method: 'POST', body: JSON.stringify({ ref: t.rollback.ref, inputs }) }, cfg.githubWriteToken);
    const url = `${repoUrl(s.repo)}/actions?workflow=${encodeURIComponent(t.rollback.workflow)}`;
    const ok = res.status === 204 || res.ok;
    await audit({ login, action: 'rollback', target, detail: `${view.current?.version ?? '?'} → ${version}`, ok, url });
    if (!ok) throw new ServiceUnavailableException(`GitHub 이 실행을 받지 않았습니다(HTTP ${res.status})`);
    this.runs.clear(); this.snapshot = null;
    return { ok: true, url, from: view.current?.version ?? null, to: version };
  }

  // ── 되돌리기 하한 ── 관리자만(컨트롤러). 지금 떠 있는 버전이나 남은 버전에만 걸 수 있다
  async setFloor(login: string, b: { service?: string; env?: string; version?: string; reason?: string; clear?: boolean }) {
    const s = this.registry.find((x) => x.key === b.service);
    const env = b.env as EnvKey;
    const t = s && ENVS.includes(env) ? s.deploy?.[env] : undefined;
    if (!s || !t) throw new BadRequestException('서비스, 환경을 찾지 못했습니다');
    const key = `${s.key}:${env}`;
    const target = `${s.repo} ${env}(${t.kamal})`;
    if (b.clear) {
      const prev = this.floors.get().floors[key];
      if (!prev) return { ok: true, floor: null };
      this.floors.update(undefined, (d) => { delete d.floors[key]; });
      await audit({ login, action: 'rollback-floor-clear', target, detail: `하한 ${prev.version} 해제`, ok: true });
      this.snapshot = null;
      return { ok: true, floor: null };
    }
    const version = String(b.version || '');
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!VERSION_RE.test(version)) throw new BadRequestException('버전은 커밋 12자입니다');
    if (!reason) throw new BadRequestException('이유를 적어 주세요, 되돌리기 창에 그대로 보입니다');
    const view = await this.track(s, env, t, true);
    const runId = firstRunOf(view.all ?? [], version);
    if (runId === null) throw new BadRequestException('이 환경에 성공한 배포 기록이 없는 버전입니다');
    const floor: Floor = { version, runId, reason, by: login, at: new Date().toISOString() };
    this.floors.update(undefined, (d) => { d.floors[key] = floor; });
    await audit({ login, action: 'rollback-floor', target, detail: `하한 ${version}, ${reason}`, ok: true });
    this.snapshot = null;
    return { ok: true, floor };
  }
}
