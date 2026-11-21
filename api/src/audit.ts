import { appendAudit, readAudit } from './persist.js';

// 감사 로그 — 되돌리기 같은 "바꾸는" 동작만 남긴다. MariaDB audit 표, DB 가 없으면 DATA_DIR/audit.jsonl
export interface AuditEntry { at: string; login: string; action: string; target: string; detail?: string; ok: boolean; url?: string }

export async function audit(e: Omit<AuditEntry, 'at'>) {
  const entry = { at: new Date().toISOString(), ...e };
  console.log(`[감사] ${JSON.stringify(entry)}`);
  try { await appendAudit(entry); }
  catch (err: any) { console.warn('[감사] 저장하지 못했다:', err?.message); }
}

export async function recentAudit(n = 50): Promise<AuditEntry[]> {
  try { return await readAudit(n); } catch { return []; }
}
