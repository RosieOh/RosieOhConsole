import { readDoc, writeDoc } from '../core/persist.js';
import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { audit } from '../core/audit.js';
import { DEFAULT_COMPONENTS } from '../catalog/defaults.js';
import { cfg, repoUrl, full } from '../core/config.js';
import { ghFetch, ghJson } from '../core/github.js';
import { DEFAULT_INFRA, PLACEMENT } from '../infra/defaults.js';
import { addrOf } from '../infra/names.js';
import { logSafe } from '../core/safe.js';
import { ProbeResult, alertsOf, parseProbe } from './parse.js';

// 서버(D) — 점검 결과 받기·보관·요청. 로그는 메모리에만(디스크·GitHub 에 남기지 않는다)
export interface ServerDef { id: string; name: string; sub?: string; ip: string | null; domains: string[]; note: string; node: string | null; repo: string; key: 'prod' | 'dev'; services: { kamal: string; comp: string }[] }
interface Point { at: string; load1: number; memPct: number; diskPct: number }

const HIST_KEEP_MS = 7 * 86400_000;
const HIST_STEP_MS = 5 * 60_000;
const WORKFLOW = 'probe.yml';

export function serverDefs(): ServerDef[] {
  return DEFAULT_INFRA.filter((i) => i.kind === 'server' && i.probe).map((i) => {
    const services: { kamal: string; comp: string }[] = [];
    for (const c of DEFAULT_COMPONENTS) {
      const p = PLACEMENT[c.key];
      if (p?.prod === i.id && c.deploy?.prod && !c.deploy.prod.compose) services.push({ kamal: c.deploy.prod.kamal, comp: c.key });
      if (p?.testbed === i.id && c.deploy?.testbed && !c.deploy.testbed.compose) services.push({ kamal: c.deploy.testbed.kamal, comp: c.key });
    }
    return { id: i.id, name: i.name, sub: i.sub, ...addrOf(i.sub), node: i.of?.project ?? null, repo: i.probe!.repo, key: i.probe!.key, services };
  });
}

@Injectable()
export class ServersService {
  readonly defs = serverDefs();
  private latest = new Map<string, { at: number; run: string; probe: ProbeResult | null; ok: boolean }>();
  private logs = new Map<string, { at: number; container: string; lines: string[] }>();
  private pending = new Map<string, { at: number; action: string; target: string; by: string }>();
  private hist: Record<string, Point[]> = {};
  private restarts: { at: string; server: string; target: string; by: string; status: string }[] = [];

  constructor() {
    try {
      const j = readDoc<any>('servers') ?? {};
      this.hist = j.hist || {};
      for (const [k, v] of Object.entries<any>(j.latest || {})) this.latest.set(k, v);
    } catch { /* 처음 */ }
  }
  private save() {
    try {
      // 로그는 저장하지 않는다(점검 결과의 logs 는 뺀다)
      const latest = Object.fromEntries([...this.latest].map(([k, v]) => [k, { ...v, probe: v.probe ? { ...v.probe, logs: undefined } : null }]));
      writeDoc('servers', { hist: this.hist, latest });
    } catch (e: any) { console.warn('[서버] 기록을 쓰지 못했다:', e?.message); }
  }

  /** 템플릿이 보낸 결과 — PROBE_TOKEN 확인 */
  ingest(auth: string | undefined, q: { server?: string; action?: string; target?: string; run?: string; ok?: string }, body: string) {
    const want = Buffer.from(`Bearer ${process.env.PROBE_TOKEN || ''}`);
    const got = Buffer.from(String(auth || ''));
    if (!process.env.PROBE_TOKEN || want.length !== got.length || !timingSafeEqual(want, got)) throw new NotFoundException();
    const def = this.defs.find((d) => d.id === q.server);
    if (!def) throw new BadRequestException('모르는 서버');
    const p = q.ok === '1' ? parseProbe(body) : null;
    const now = Date.now();
    this.latest.set(def.id, { at: now, run: String(q.run || ''), probe: p, ok: !!p });
    if (p) {
      const list = (this.hist[def.id] ||= []);
      const last = list[list.length - 1];
      if (!last || now - Date.parse(last.at) >= HIST_STEP_MS) {
        list.push({ at: new Date(now).toISOString(), load1: p.load[0], memPct: p.mem.total ? Math.round((1 - p.mem.available / p.mem.total) * 1000) / 10 : 0, diskPct: Math.max(0, ...p.disks.map((d) => d.pct)) });
        while (list.length && now - Date.parse(list[0].at) > HIST_KEEP_MS) list.shift();
      }
      if (p.logs) this.logs.set(`${def.id}:${q.target}`, { at: now, container: p.logs.container, lines: p.logs.lines });
      if (p.restart) {
        this.restarts.unshift({ at: new Date(now).toISOString(), server: def.id, target: String(q.target), by: this.pending.get(`${def.id}:restart`)?.by ?? '?', status: p.restart.status });
        void audit({ login: this.pending.get(`${def.id}:restart`)?.by ?? '?', action: 'server.restart.done', target: `${def.id} ${q.target}`, detail: p.restart.status || '컨테이너 없음', ok: !!p.restart.container });
      }
    }
    this.pending.delete(`${def.id}:${q.action}`);
    this.save();
    if (!process.env.NODE_TEST_CONTEXT) console.log(`[서버] ${def.id} ${logSafe(q.action, 20)} 결과 ${p ? '받음' : '접속 실패'}`);
    return { ok: true };
  }

  list() {
    const now = Date.now();
    return {
      servers: this.defs.map((d) => {
        const l = this.latest.get(d.id);
        const p = l?.probe ?? null;
        return {
          ...d, at: l ? new Date(l.at).toISOString() : null, run: l?.run ?? null, reachable: l ? l.ok : null,
          probe: p ? { ...p, logs: undefined } : null,
          alerts: l && !l.ok ? [{ level: 'bad' as const, text: '서버에 접속하지 못했습니다(점검 실패)' }] : alertsOf(p, l?.at ?? null, d.services.map((s) => s.kamal), now),
          history: this.hist[d.id] || [],
          pending: [...this.pending.entries()].filter(([k]) => k.startsWith(d.id + ':')).map(([, v]) => v),
        };
      }),
      restarts: this.restarts.slice(0, 30),
      canRun: !!cfg.githubWriteToken && !!process.env.PROBE_TOKEN,
    };
  }

  logsOf(id: string, target: string) {
    const l = this.logs.get(`${id}:${target}`);
    return { at: l ? new Date(l.at).toISOString() : null, container: l?.container ?? null, lines: l?.lines ?? [], pending: this.pending.has(`${id}:logs`) };
  }

  /** 점검·로그·재시작 요청 — 그 서버를 맡은 저장소의 probe.yml 을 부른다 */
  async request(login: string, id: string, action: 'probe' | 'logs' | 'restart', target = '', confirm = '', lines = 300) {
    const d = this.defs.find((x) => x.id === id);
    if (!d) throw new NotFoundException('모르는 서버입니다');
    if (!cfg.githubWriteToken) throw new ServiceUnavailableException('콘솔에 쓰기 토큰이 없습니다');
    if (action !== 'probe' && !d.services.some((s) => s.kamal === target)) throw new BadRequestException('이 서버의 서비스가 아닙니다');
    if (action === 'restart' && confirm !== target) throw new BadRequestException(`확인 이름이 다릅니다, "${target}" 를 그대로 입력하세요`);
    const busy = this.pending.get(`${id}:${action}`);
    if (busy && Date.now() - busy.at < 5 * 60_000) return { ok: true, already: true };
    const inputs: Record<string, string> = { action, target, lines: String(Math.min(Math.max(lines, 50), 2000)), confirm: action === 'restart' ? confirm : '' };
    const res = await ghFetch(`repos/${full(d.repo)}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: await this.ref(d.repo), inputs }) }, cfg.githubWriteToken);
    const ok = res.status === 204 || res.ok;
    if (action === 'restart') await audit({ login, action: 'server.restart', target: `${id} ${target}`, detail: ok ? '요청' : `HTTP ${res.status}`, ok, url: `${repoUrl(d.repo)}/actions?workflow=${WORKFLOW}` });
    if (!ok) throw new ServiceUnavailableException(`GitHub 이 실행을 받지 않았습니다(HTTP ${res.status}), ${d.repo} 에 probe.yml 이 있는지 확인하세요`);
    this.pending.set(`${id}:${action}`, { at: Date.now(), action, target, by: login });
    return { ok: true };
  }

  private refs = new Map<string, string>();
  private async ref(repo: string) {
    if (!this.refs.has(repo)) this.refs.set(repo, (await ghJson<any>(`repos/${full(repo)}`))?.default_branch || 'main');
    return this.refs.get(repo)!;
  }
}
