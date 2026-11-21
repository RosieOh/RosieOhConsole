import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { audit } from '../audit.js';
import { EnvFlags, FLAG_TARGETS, FlagEnv, FlagTarget, mergeFlags, FlagSummary, summarizeFlags } from './targets.js';

const TTL_MS = 10 * 1000;
const tokenOf = (t: FlagTarget) => process.env[t.tokenEnv] || '';

@Injectable()
export class FlagsService {
  private cache: { at: number; data: any } | null = null;

  private async call(t: FlagTarget, path: string, init: RequestInit = {}) {
    const res = await fetch(`${t.base}/api/console/flags${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${tokenOf(t)}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(res.status === 404 ? '서비스에 스위치 주소가 없거나 토큰이 설정되지 않음(404)' : res.status === 403 ? '토큰이 맞지 않음(403)' : `HTTP ${res.status} ${body?.error ?? ''}`.trim());
    return body;
  }

  private async envOf(t: FlagTarget): Promise<EnvFlags> {
    if (!tokenOf(t)) return { env: t.env, configured: false, ok: false, flags: [] };
    try {
      const b = await this.call(t, '');
      return { env: t.env, configured: true, ok: true, loadedAt: b.loadedAt ?? null, flags: b.flags ?? [] };
    } catch (e: any) {
      return { env: t.env, configured: true, ok: false, error: String(e?.message || e), flags: [] };
    }
  }

  async list(force = false) {
    if (!force && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.data;
    const comps = [...new Set(FLAG_TARGETS.map((t) => t.comp))];
    const services = await Promise.all(comps.map(async (comp) => {
      const envs = await Promise.all(FLAG_TARGETS.filter((t) => t.comp === comp).map((t) => this.envOf(t)));
      return { comp, envs: envs.map(({ flags, ...rest }) => rest), rows: mergeFlags(envs) };
    }));
    const data = { services, updatedAt: new Date().toISOString() };
    this.cache = { at: Date.now(), data };
    return data;
  }

  // 관리자·배포 담당만(컨트롤러). 운영은 서비스 키를 직접 입력해야 한다
  async set(login: string, b: { comp?: string; env?: string; key?: string; enabled?: boolean; confirm?: string }) {
    const t = FLAG_TARGETS.find((x) => x.comp === b.comp && x.env === b.env);
    if (!t) throw new BadRequestException('스위치를 연결하지 않은 서비스, 환경입니다');
    if (!tokenOf(t)) throw new ServiceUnavailableException(`콘솔에 ${t.tokenEnv} 가 없습니다`);
    const key = String(b.key || '');
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(key)) throw new BadRequestException('스위치 이름이 올바르지 않습니다');
    if (typeof b.enabled !== 'boolean') throw new BadRequestException('켜기, 끄기 값이 없습니다');
    if (t.env === 'prod' && b.confirm !== t.comp) throw new BadRequestException(`운영은 확인을 위해 "${t.comp}" 를 그대로 입력하세요`);
    const target = `${t.comp} ${t.env} 스위치 ${key}`;
    try {
      const flag = await this.call(t, `/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ enabled: b.enabled, by: login }) });
      await audit({ login, action: 'flag', target, detail: b.enabled ? '켜짐' : '꺼짐', ok: true });
      this.cache = null;
      return { ok: true, flag };
    } catch (e: any) {
      await audit({ login, action: 'flag', target, detail: `${b.enabled ? '켜기' : '끄기'} 실패, ${e?.message}`, ok: false });
      throw new ServiceUnavailableException(`서비스가 바꾸지 못했습니다: ${e?.message}`);
    }
  }

  /** 흐름 도식 배지용 — 서비스마다 켜진 스위치 수(기본값과 다른 것만). 서비스를 못 읽으면 그 서비스는 빠진다 */
  async summary(): Promise<FlagSummary> {
    const d = await this.list().catch(() => null);
    return summarizeFlags(d?.services ?? []);
  }

}
