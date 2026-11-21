import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { audit } from '../audit.js';
import { DEFAULT_COMPONENTS } from '../catalog/defaults.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { cfg, full } from '../config.js';
import { DeployService } from '../deploy/deploy.service.js';
import { ghFetch, ghJson } from '../github.js';
import { JsonStore, RevConflict, Versioned } from '../json-store.js';
import { StatusService } from '../status.service.js';
import { Plan, checkAt, issueRefs, planOf } from './plan.js';

// 운영 승격·예약(B) — 테스트배드에서 지켜본 버전을 정한 시각에 운영으로.
// 실행 순서: 다시 검사 → (필요하면) 그 커밋으로 릴리스 PR → 검사 기다려 머지 → (kamal-prod 면) deploy 실행 → 끝까지 지켜보고 운영 버전·헬스 확인
export type SchedState = 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Schedule {
  id: string; comp: string; repo: string; version: string; sha: string; at: string; by: string; createdAt: string;
  state: SchedState; plan: Plan; log: { at: string; msg: string; ok?: boolean }[];
  pr?: { number: number; url: string }; run?: { id: number; url: string }; result?: string; cancelledBy?: string;
  phase?: 'merged' | 'dispatched';      // 여기까지 했으면 재시작 뒤 지켜보기부터 잇는다
  mergedAt?: number; mainSha?: string;
}
interface SchedFile extends Versioned { items: Record<string, Schedule> }

const WAIT_CHECK_MS = 15 * 60 * 1000;     // mx/issue-link 를 기다리는 한도
const WAIT_RUN_MS = 60 * 60 * 1000;       // 배포 실행을 기다리는 한도
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class PromoteService implements OnModuleInit, OnModuleDestroy {
  readonly store = new JsonStore<SchedFile>(`${cfg.dataDir}/schedules.json`, () => ({ rev: 0, items: {} }));
  private timer?: NodeJS.Timeout;
  private busy = new Set<string>();

  constructor(private readonly deploy: DeployService, private readonly status: StatusService, private readonly catalog: CatalogService) {}

  onModuleInit() {
    // 콘솔이 실행 도중 재시작됐을 때: 머지·실행 요청까지 끝났으면 결과 지켜보기부터 잇는다(콘솔 자신을 올리면 늘 이렇게 된다).
    // 그 전 단계에서 끊겼으면 반쯤 한 일을 되풀이하지 않고 실패로 남긴다
    const stuck = Object.values(this.store.get().items).filter((s) => s.state === 'running');
    const resume = stuck.filter((s) => s.phase);
    const dead = stuck.filter((s) => !s.phase);
    if (dead.length) this.store.update(undefined, (d) => { for (const s of dead) { d.items[s.id].state = 'failed'; d.items[s.id].log.push({ at: new Date().toISOString(), msg: '머지 전에 콘솔이 재시작됨, 다시 예약하세요', ok: false }); } });
    if (process.env.PROMOTE_RUN === 'off') return;
    for (const s of resume) {
      this.busy.add(s.id);
      setTimeout(() => { this.note(s.id, '콘솔 재시작, 결과 지켜보기를 잇는다'); void this.watch(s.id).finally(() => this.busy.delete(s.id)); }, 5000);
    }
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private def(key: string) { return DEFAULT_COMPONENTS.find((c) => c.key === key); }

  // ── 후보 ── 운영에 올릴 수 있는 구성요소마다 지금 상태
  async candidates() {
    const names = Object.fromEntries(this.catalog.view().components.map((c) => [c.key, c.name]));
    const out = [];
    for (const c of DEFAULT_COMPONENTS) {
      const plan = planOf(c);
      if (!plan) continue;
      try { out.push({ key: c.key, name: names[c.key] ?? c.name, repo: c.repo, ...(await this.state(c.key, plan)) }); }
      catch (e: any) { out.push({ key: c.key, name: names[c.key] ?? c.name, repo: c.repo, plan, error: String(e?.message || e) }); }
    }
    return { items: out, schedules: this.list(), canRun: !!cfg.githubWriteToken };
  }

  /** 한 구성요소 — 올릴 버전(테스트배드 지금 것 또는 dev 끝), 운영 지금 버전, main 과의 차이, 테스트배드 정상 유지 시간 */
  async state(key: string, plan = planOf(this.def(key)!)!) {
    const c = this.def(key)!;
    let version: string | null = null; let sha: string | null = null; let testbedAt: string | null = null;
    if (plan.source === 'testbed') {
      const tb = await this.deploy.trackNow(key, 'testbed');
      version = tb?.current?.version ?? null; testbedAt = tb?.current?.at ?? null;
      if (version) sha = (await ghJson<any>(`repos/${full(c.repo)}/git/commits/${version}`))?.sha ?? null;
    } else {
      const dev = await ghJson<any>(`repos/${full(c.repo)}/branches/dev`);
      sha = dev?.commit?.sha ?? null; version = sha ? sha.slice(0, 12) : null;
    }
    const prod = plan.lane === 'prod' ? await this.deploy.trackNow(key, 'prod') : null;
    const main = await ghJson<any>(`repos/${full(c.repo)}/branches/main`);
    let ahead: { sha: string; message: string; author: string }[] = [];
    let mainOnly = 0;
    if (sha && main?.commit?.sha) {
      const cmp = await ghJson<any>(`repos/${full(c.repo)}/compare/${main.commit.sha}...${sha}`).catch(() => null);
      ahead = (cmp?.commits || []).filter((x: any) => (x.parents?.length ?? 1) < 2).map((x: any) => ({ sha: x.sha.slice(0, 12), message: String(x.commit?.message || '').split('\n')[0], author: x.commit?.author?.name || '' }));
      const back = await ghJson<any>(`repos/${full(c.repo)}/compare/${sha}...${main.commit.sha}`).catch(() => null);
      mainOnly = (back?.commits || []).filter((x: any) => (x.parents?.length ?? 1) < 2).length;
    }
    const tbHealth = plan.source === 'testbed' ? this.status.streak(key, 'testbed') : null;
    return {
      plan, version, sha, testbedAt, testbedHealth: tbHealth,
      prodVersion: prod?.current?.version ?? null, prodAt: prod?.current?.at ?? null, prodRunning: (prod?.running.length ?? 0) > 0,
      mainSha: main?.commit?.sha?.slice(0, 12) ?? null, ahead: ahead.slice(0, 50), aheadCount: ahead.length, mainOnly,
    };
  }

  list() { return Object.values(this.store.get().items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100); }

  // ── 예약 ──
  async schedule(login: string, b: { comp?: string; version?: string; at?: string; confirm?: string }) {
    const c = this.def(String(b.comp || ''));
    const plan = c && planOf(c);
    if (!c || !plan) throw new BadRequestException('운영에 올릴 수 없는 구성요소입니다');
    if (!cfg.githubWriteToken) throw new ServiceUnavailableException('콘솔에 쓰기 토큰(GITHUB_WRITE_TOKEN)이 없습니다');
    const bad = checkAt(String(b.at || ''));
    if (bad) throw new BadRequestException(bad);
    if (b.confirm !== plan.confirm) throw new BadRequestException(`확인 이름이 다릅니다, "${plan.confirm}" 를 그대로 입력하세요`);
    const st = await this.state(c.key, plan);
    if (!st.version || !st.sha) throw new BadRequestException(plan.source === 'testbed' ? '테스트배드에 올라간 버전을 찾지 못했습니다' : 'dev 브랜치를 읽지 못했습니다');
    if (b.version !== st.version) throw new ConflictException(`올릴 버전이 바뀌었습니다(지금 ${st.version}), 새로고침하세요`);
    if (st.aheadCount === 0) throw new BadRequestException('main 에 이미 들어 있습니다, 올릴 변경이 없습니다');
    if (Object.values(this.store.get().items).some((s) => s.comp === c.key && (s.state === 'scheduled' || s.state === 'running'))) throw new ConflictException('이 서비스에 이미 잡힌 예약이 있습니다, 취소한 뒤 다시 잡으세요');
    const id = `s-${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const item: Schedule = { id, comp: c.key, repo: c.repo, version: st.version, sha: st.sha, at: new Date(Date.parse(b.at!)).toISOString(), by: login, createdAt: now, state: 'scheduled', plan,
      log: [{ at: now, msg: `${login} 예약, ${st.version}, 변경 ${st.aheadCount}개${st.mainOnly ? `, main 에만 있는 변경 ${st.mainOnly}개 함께 나감` : ''}` }] };
    this.store.update(undefined, (d) => { d.items[id] = item; });
    await audit({ login, action: 'promote.schedule', target: `${c.repo} ${c.key}`, detail: `${st.version} @ ${item.at}`, ok: true });
    return item;
  }

  async cancel(login: string, id: string) {
    const s = this.store.get().items[id];
    if (!s) throw new NotFoundException();
    if (s.state !== 'scheduled') throw new ConflictException('이미 시작했거나 끝난 예약은 취소할 수 없습니다');
    this.store.update(undefined, (d) => { d.items[id].state = 'cancelled'; d.items[id].cancelledBy = login; d.items[id].log.push({ at: new Date().toISOString(), msg: `${login} 취소` }); });
    await audit({ login, action: 'promote.cancel', target: `${s.repo} ${s.comp}`, detail: s.version, ok: true });
    return { ok: true };
  }

  // ── 실행기 ──
  private async tick() {
    const due = Object.values(this.store.get().items).filter((s) => s.state === 'scheduled' && Date.parse(s.at) <= Date.now());
    for (const s of due) if (!this.busy.has(s.id)) { this.busy.add(s.id); void this.run(s.id).finally(() => this.busy.delete(s.id)); }
  }

  private note(id: string, msg: string, ok?: boolean, patch: Partial<Schedule> = {}) {
    try { this.store.update(undefined, (d) => { Object.assign(d.items[id], patch); d.items[id].log.push({ at: new Date().toISOString(), msg, ok }); }); }
    catch (e) { if (!(e instanceof RevConflict)) throw e; }
    console.log(`[승격] ${id} ${msg}`);
  }

  private async write(path: string, method: string, body?: unknown) {
    return ghFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cfg.githubWriteToken, 30000);
  }

  async run(id: string) {
    const s = this.store.get().items[id];
    const fail = async (msg: string) => { this.note(id, msg, false, { state: 'failed', result: msg }); await audit({ login: s.by, action: 'promote.run', target: `${s.repo} ${s.comp}`, detail: `${s.version} 실패: ${msg}`, ok: false }); };
    this.note(id, '시작, 다시 검사', undefined, { state: 'running' });
    try {
      // 1) 다시 검사: 올릴 버전이 그대로인가, 테스트배드가 정상인가, 운영에 실행 중인 배포가 없나
      const st = await this.state(s.comp, s.plan);
      if (st.version !== s.version) return await fail(`올릴 버전이 바뀌었습니다(예약 ${s.version} → 지금 ${st.version ?? '없음'}), 다시 예약하세요`);
      if (s.plan.source === 'testbed' && st.testbedHealth && st.testbedHealth.up === false) return await fail('테스트배드가 DOWN 입니다, 올리지 않습니다');
      if (st.prodRunning) return await fail('운영에 이미 실행 중인 배포가 있습니다');
      if (st.aheadCount === 0) { this.note(id, 'main 에 이미 들어 있음, 머지 건너뜀', true); }

      // 2) 그 커밋으로 릴리스 PR → 검사(커밋 상태) 기다려 머지. 브랜치 보호의 필수 검사가 덜 끝났으면 머지가 405 로 거절돼 다시 시도한다
      let mergedAt = Date.now();
      if (st.aheadCount > 0) {
        const branch = `release/console-${s.comp}-${s.version}`;
        const mk = await this.write(`repos/${full(s.repo)}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: s.sha });
        if (!mk.ok && mk.status !== 422) return await fail(`릴리스 브랜치를 만들지 못했습니다(HTTP ${mk.status})`);
        const refs = issueRefs(st.ahead.map((x) => x.message));
        const body = [`콘솔 예약 승격, ${s.by} 가 ${new Date(s.createdAt).toLocaleString('ko-KR')} 에 잡은 예약(${s.id}).`, '',
          `${s.plan.source === 'testbed' ? '테스트배드에서 지켜본' : 'dev 끝'} 버전 ${s.version} 을 main 으로.`, '',
          ...st.ahead.slice(0, 40).map((x) => `- ${x.sha} ${x.message}`), '', refs.length ? `관련: ${refs.map((n) => '#' + n).join(' ')}` : ''].join('\n');
        const pr = await this.write(`repos/${full(s.repo)}/pulls`, 'POST', { title: `릴리스: ${s.version} (콘솔 예약 ${refs.slice(0, 5).map((n) => '#' + n).join(' ')})`.trim(), head: branch, base: 'main', body });
        if (!pr.ok) return await fail(`릴리스 PR 을 만들지 못했습니다(HTTP ${pr.status}), 같은 PR 이 이미 열려 있는지 확인하세요`);
        const prj: any = await pr.json();
        this.note(id, `릴리스 PR #${prj.number}, 검사 기다림`, undefined, { pr: { number: prj.number, url: prj.html_url } });
        const until = Date.now() + WAIT_CHECK_MS;
        let merged = false; let last = '';
        while (Date.now() < until) {
          const head = (await ghJson<any>(`repos/${full(s.repo)}/pulls/${prj.number}`))?.head?.sha;
          const stj = head ? await ghJson<any>(`repos/${full(s.repo)}/commits/${head}/status`) : null;
          if (stj?.state === 'failure' || stj?.state === 'error') return await fail(`커밋 검사 실패, 릴리스 PR #${prj.number} 를 확인하세요`);
          const m = await this.write(`repos/${full(s.repo)}/pulls/${prj.number}/merge`, 'POST', { merge_method: 'merge' });
          if (m.ok) { merged = true; break; }
          last = `HTTP ${m.status}`;
          await sleep(15_000);
        }
        if (!merged) return await fail(`머지하지 못했습니다(${last}), 릴리스 PR #${prj.number} 를 확인하세요`);
        mergedAt = Date.now();
      }
      const mainSha = (await ghJson<any>(`repos/${full(s.repo)}/branches/main`))?.commit?.sha?.slice(0, 12);
      this.note(id, st.aheadCount > 0 ? `릴리스 PR 머지, main ${mainSha}` : `main ${mainSha}`, true, { phase: 'merged', mergedAt, mainSha });

      // 3) kamal-prod 면 deploy 실행
      if (s.plan.method === 'merge-dispatch' && s.plan.dispatch) {
        const d = s.plan.dispatch;
        const r = await this.write(`repos/${full(s.repo)}/actions/workflows/${encodeURIComponent(d.workflow)}/dispatches`, 'POST', { ref: d.ref, inputs: d.inputs });
        if (!(r.status === 204 || r.ok)) return await fail(`운영 배포 실행을 GitHub 이 받지 않았습니다(HTTP ${r.status})`);
        this.note(id, `운영 배포 실행 요청, ${d.workflow} deploy`, true, { phase: 'dispatched' });
      }
      await this.watch(id);
    } catch (e: any) {
      await fail(`오류: ${e?.message || e}`);
    }
  }

  /** 머지(·실행 요청) 뒤 — 그 뒤 시작된 실행을 끝까지 지켜보고 운영 버전 확인. 콘솔이 재시작되면 여기서부터 잇는다 */
  private async watch(id: string) {
    const s = this.store.get().items[id];
    const mergedAt = s.mergedAt ?? Date.now();
    const mainSha = s.mainSha;
    const fail = async (msg: string) => { this.note(id, msg, false, { state: 'failed', result: msg }); await audit({ login: s.by, action: 'promote.run', target: `${s.repo} ${s.comp}`, detail: `${s.version} 실패: ${msg}`, ok: false }); };
    try {

      const until = Date.now() + WAIT_RUN_MS;
      let run: any = null;
      while (Date.now() < until) {
        const runs: any[] = (await ghJson<any>(`repos/${full(s.repo)}/actions/workflows/${encodeURIComponent(s.plan.watch)}/runs?per_page=5`))?.workflow_runs || [];
        run = runs.find((r) => Date.parse(r.run_started_at || r.created_at || 0) >= mergedAt - 60_000) ?? null;
        if (run && !this.store.get().items[id].run) this.note(id, `실행 #${run.run_number} 시작`, undefined, { run: { id: run.id, url: run.html_url } });
        if (run?.status === 'completed') break;
        await sleep(15_000);
      }
      if (!run) return await fail('머지 뒤 배포 실행이 시작되지 않았습니다, Actions 를 확인하세요');
      if (run.status !== 'completed') return await fail(`실행 #${run.run_number} 이 1시간 안에 끝나지 않았습니다`);
      if (run.conclusion !== 'success') return await fail(`실행 #${run.run_number} 실패, 로그를 확인하세요(운영은 Kamal 이 옛 버전을 유지)`);
      if (s.plan.lane === 'prod') {
        const prod = await this.deploy.trackNow(s.comp, 'prod');
        const now = prod?.current?.version;
        if (mainSha && now && now !== mainSha) return await fail(`운영 버전이 ${now} 입니다(기대 ${mainSha})`);
      }
      const msg = `완료, 운영 ${mainSha ?? s.version}${s.plan.lane !== 'prod' ? ` (${s.plan.lane === 'store' ? '부모앱 릴리스' : 'APK 릴리스'})` : ''}`;
      this.note(id, msg, true, { state: 'done', result: msg });
      await audit({ login: s.by, action: 'promote.run', target: `${s.repo} ${s.comp}`, detail: `${s.version} → 운영 ${mainSha}`, ok: true, url: run.html_url });
    } catch (e: any) {
      await fail(`오류: ${e?.message || e}`);
    }
  }
}
