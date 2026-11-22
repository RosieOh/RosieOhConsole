import { appendAudit, readAudit } from './persist.js';

// 감사 로그 — 되돌리기 같은 "바꾸는" 동작만 남긴다. MariaDB audit 표, DB 가 없으면 DATA_DIR/audit.jsonl
export interface AuditEntry { at: string; login: string; action: string; target: string; detail?: string; ok: boolean; url?: string }

export async function audit(e: Omit<AuditEntry, 'at'>) {
  const entry = { at: new Date().toISOString(), ...e };
  // node --test 의 자식 프로세스(NODE_TEST_CONTEXT)에서는 찍지 않는다 — Node 22 는 시험 결과를 stdout 으로 직렬화해 보내는데,
  // 그 사이에 한글 로그가 섞이면 부모가 'Unable to deserialize cloned data' 로 깨진다(CI 에서 간헐적으로 실패)
  if (!process.env.NODE_TEST_CONTEXT) console.log(`[감사] ${JSON.stringify(entry)}`);
  try { await appendAudit(entry); }
  catch (err: any) { console.warn('[감사] 저장하지 못했다:', err?.message); }
}

export async function recentAudit(n = 50): Promise<AuditEntry[]> {
  try { return await readAudit(n); } catch { return []; }
}
