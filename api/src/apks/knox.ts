import { cfg } from '../core/config.js';
import { JsonStore, Versioned } from '../core/json-store.js';

// 녹스(Knox) 적용 상태 — 담당자가 받아서 녹스에 올렸는지 직접 표시한다. 받기만 하고 표시 안 하면 "QA 중"
export interface VerState { downloads: number; lastDownload?: { at: string; who: string }; knox?: { at: string; by: string }; note?: { text: string; by: string; at: string } }
export interface KnoxFile extends Versioned { apps: Record<string, { versions: Record<string, VerState>; history: { at: string; by: string; tag: string; action: 'knox' | 'undo' }[] }> }

export const knoxStore = () => new JsonStore<KnoxFile>(`${cfg.dataDir}/apk-state.json`, () => ({ rev: 0, apps: {} }));

export type Status = 'knox' | 'qa' | 'new';
/** 한 버전의 상태 — 녹스 적용됨 / QA 중(받았지만 적용 표시 없음) / 새 버전(아직 아무도 안 받음) */
export function statusOf(v?: VerState): Status { return v?.knox ? 'knox' : v?.downloads ? 'qa' : 'new'; }

/** 녹스에 지금 올라간 버전 — 적용 표시가 가장 늦은 버전 */
export function currentKnox(versions: Record<string, VerState>): { tag: string; at: string; by: string } | null {
  let best: { tag: string; at: string; by: string } | null = null;
  for (const [tag, v] of Object.entries(versions)) if (v.knox && (!best || v.knox.at > best.at)) best = { tag, ...v.knox };
  return best;
}

export const WHO_RE = /^[\p{L}\p{N} ._-]{1,30}$/u;
