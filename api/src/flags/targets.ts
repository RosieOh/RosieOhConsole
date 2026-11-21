// 기능 스위치 — 콘솔이 값을 바꿀 수 있는 서비스·환경.
// 서비스는 /api/console/flags 를 열고(공통 규칙), 토큰은 환경마다 따로 console.env 에 둔다. 토큰이 없으면 "연결 안 됨".
export type FlagEnv = 'testbed' | 'prod';
export interface FlagTarget { comp: string; env: FlagEnv; base: string; tokenEnv: string }

// 예: { comp: 'my-api', env: 'prod', base: 'https://api.example.com', tokenEnv: 'FLAGS_TOKEN_MY_API_PROD' }
export const FLAG_TARGETS: FlagTarget[] = [];

export interface FlagView { key: string; description: string; defaultValue: boolean; enabled: boolean; overridden: boolean; updatedBy: string | null; updatedAt: string | null }
export interface EnvFlags { env: FlagEnv; configured: boolean; ok: boolean; error?: string; loadedAt?: string | null; flags: FlagView[] }
export interface FlagRow { key: string; description: string; defaultValue: boolean; envs: Partial<Record<FlagEnv, FlagView | null>> }

export type FlagSummary = Record<string, { env: FlagEnv; on: number }[]>;

/** 흐름 도식 배지 — 서비스마다 환경별로 기본값과 다르게 켜 둔 스위치 수(0 이면 뺀다) */
export function summarizeFlags(services: { comp: string; rows: FlagRow[] }[]): FlagSummary {
  const out: FlagSummary = {};
  for (const s of services) for (const env of ['prod', 'testbed'] as FlagEnv[]) {
    const on = s.rows.filter((r) => r.envs[env]?.overridden && r.envs[env]?.enabled !== r.defaultValue).length;
    if (on) (out[s.comp] ??= []).push({ env, on });
  }
  return out;
}

/** 환경별 목록을 스위치 하나당 한 줄로 — 한쪽에만 있는 스위치(배포가 아직 안 된 쪽)는 그 칸이 null */
export function mergeFlags(envs: EnvFlags[]): FlagRow[] {
  const rows = new Map<string, FlagRow>();
  for (const e of envs) for (const f of e.flags) {
    const r = rows.get(f.key) ?? { key: f.key, description: f.description, defaultValue: f.defaultValue, envs: {} };
    r.envs[e.env] = f;
    rows.set(f.key, r);
  }
  for (const r of rows.values()) for (const e of envs) if (e.ok && !(e.env in r.envs)) r.envs[e.env] = null;
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}
