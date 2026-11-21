import { readDoc, writeDoc } from './persist.js';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from './config.js';
import { Endpoint, ServiceDef, loadRegistry } from './registry.js';

export type EnvKey = 'testbed' | 'prod';
export interface EnvStatus {
  up: boolean;
  db_status?: string | null;
  redis_status?: string | null;
  latency_ms?: number;
  checked_at: string;
  error?: string;
  link: string;
}
export interface ServiceStatus {
  key: string; name: string; repo: string; kind: string; docs?: string;
  testbed?: EnvStatus; prod?: EnvStatus;
}

const POLL_INTERVAL_MS = 15000;
const TIMEOUT_MS = 6000;

/** 헬스 응답에서 상태를 읽는다 — Spring actuator · {status} · {data:{status}} · 그 밖(HTML 등)은 HTTP 코드만 */
export function readHealth(body: unknown, httpOk: boolean): Pick<EnvStatus, 'up' | 'db_status' | 'redis_status'> {
  const j: any = body;
  if (!j || typeof j !== 'object') return { up: httpOk };
  const status = j.status ?? j.data?.status;
  const comp = (k: string) => j.components?.[k]?.status ?? (typeof j[k] === 'string' ? j[k] : null);
  return {
    up: httpOk && (status === undefined || status === 'UP' || j.ok === true),
    db_status: comp('db'),
    redis_status: comp('redis'),
  };
}

@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private readonly registry: ServiceDef[] = loadRegistry();
  private readonly cache = new Map<string, EnvStatus>();
  private timer?: NodeJS.Timeout;
  // UP/DOWN 바뀐 순간만 남긴다(14일) — "테스트배드에서 몇 시간째 정상인가"(승격)·가동률
  private changes: Record<string, { at: string; up: boolean }[]> = (() => {
    try { return readDoc('health-history') ?? {}; } catch { return {}; }
  })();
  private changesDirty = false;

  onModuleInit() {
    void this.pollAll();
    this.timer = setInterval(() => void this.pollAll(), POLL_INTERVAL_MS);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  registryInfo() { return this.registry; }

  getAll(): ServiceStatus[] {
    return this.registry.map((s) => {
      const out: ServiceStatus = { key: s.key, name: s.name, repo: s.repo, kind: s.kind, docs: s.docs };
      for (const env of ['testbed', 'prod'] as EnvKey[]) {
        const ep = s[env];
        if (ep) out[env] = this.cache.get(`${s.key}:${env}`) ?? { up: false, checked_at: '', link: ep.link };
      }
      return out;
    });
  }

  private async pollAll() {
    const jobs: Promise<void>[] = [];
    for (const s of this.registry) for (const env of ['testbed', 'prod'] as EnvKey[]) {
      const ep = s[env];
      if (ep) jobs.push(this.pollOne(`${s.key}:${env}`, ep));
    }
    await Promise.all(jobs);
    this.saveChanges();
  }

  private async pollOne(id: string, ep: Endpoint) {
    const started = Date.now();
    const out: EnvStatus = { up: false, checked_at: new Date().toISOString(), link: ep.link };
    try {
      const res = await fetch(ep.health, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'rosie-console' } });
      const text = await res.text();
      out.latency_ms = Date.now() - started;
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { /* HTML 등 */ }
      Object.assign(out, readHealth(body, res.ok));
      if (!res.ok) out.error = `HTTP ${res.status}`;
    } catch (e: any) {
      out.error = e?.name === 'TimeoutError' ? 'timeout' : String(e?.cause?.code || e?.message || e);
      out.latency_ms = Date.now() - started;
    }
    const list = (this.changes[id] ||= []);
    const last = list[list.length - 1];
    if (!last || last.up !== out.up) {
      list.push({ at: out.checked_at, up: out.up });
      const cut = Date.now() - 14 * 86400_000;
      while (list.length && Date.parse(list[0].at) < cut && list.length > 1) list.shift();
      this.changesDirty = true;
    }
    this.cache.set(id, out);
  }

  private saveChanges() {
    if (!this.changesDirty) return;
    this.changesDirty = false;
    try { writeDoc('health-history', this.changes); }
    catch (e: any) { console.warn('[상태] 기록을 쓰지 못했다:', e?.message); }
  }

  /** 지금 상태가 언제부터 이어졌나 + 24시간 안의 DOWN 횟수 */
  streak(key: string, env: EnvKey) {
    const list = this.changes[`${key}:${env}`] || [];
    const last = list[list.length - 1];
    const day = Date.now() - 86400_000;
    return { up: last?.up ?? null, since: last?.at ?? null, downs24h: list.filter((c) => !c.up && Date.parse(c.at) >= day).length, tracked: list[0]?.at ?? null };
  }
}
