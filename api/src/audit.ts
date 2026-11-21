import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { cfg } from './config.js';

// 감사 로그 — 되돌리기 같은 "바꾸는" 동작만 남긴다. 콘솔 데이터 볼륨(/data)의 JSONL 한 파일.
export interface AuditEntry { at: string; login: string; action: string; target: string; detail?: string; ok: boolean; url?: string }

const file = () => `${cfg.dataDir}/audit.jsonl`;

export async function audit(e: Omit<AuditEntry, 'at'>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...e });
  console.log(`[감사] ${line}`);
  try { await mkdir(cfg.dataDir, { recursive: true }); await appendFile(file(), line + '\n', 'utf8'); }
  catch (err: any) { console.warn('[감사] 파일에 쓰지 못했다:', err?.message); }
}

export async function recentAudit(n = 50): Promise<AuditEntry[]> {
  try {
    const lines = (await readFile(file(), 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-n).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}
